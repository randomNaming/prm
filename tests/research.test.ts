import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { agentTasks, companies, companyFacts, contactFacts, contacts, fieldDefs } from "../server/db/schema";
import { db, closeDb } from "../server/utils/db";
import { runQueueTick, resetQueueRateLimit } from "../server/utils/worker";
import { contactFixture, resetDatabase, useAgentEnv } from "./helpers";
import { startStubModel, type StubModel } from "./stub-model";

let stub: StubModel | null = null;

beforeEach(async () => {
	await resetDatabase();
	resetQueueRateLimit();
});

afterEach(async () => {
	if (stub) {
		await stub.close();
		stub = null;
	}
});

afterAll(async () => {
	await closeDb();
});

describe("FR-5 新建联系人后自动研究（无人点击）", () => {
	test("队列认领后走完研究：空字段直接写入，事实带 evidence 与 source", async () => {
		const contact = await contactFixture({ notes: "王小明，产品经理，邮箱 wang@example.com" });

		stub = await startStubModel([
			{
				reasoning: "备注里写明了职位和邮箱。",
				toolCalls: [
					{
						name: "record_fact",
						args: {
							contact_id: contact.id,
							field: "title",
							value: "产品经理",
							evidence: [{ kind: "crm.note", quote: "王小明，产品经理", ref: contact.id }],
							source: "agent",
						},
					},
					{
						name: "record_fact",
						args: {
							contact_id: contact.id,
							field: "email",
							value: "wang@example.com",
							evidence: [{ kind: "crm.note", quote: "邮箱 wang@example.com", ref: contact.id }],
							source: "agent",
						},
					},
				],
			},
			{ content: "已补全职位与邮箱。" },
		]);
		useAgentEnv(stub.baseUrl);

		const { enqueueResearch, claimDueTask } = await import("../server/utils/queue");
		const taskId = await enqueueResearch(contact.id, "新建联系人，自动触发一次后台研究。");
		expect(taskId).toBeTruthy();

		const result = await runQueueTick();

		expect(result.claimed).toBe(1);
		expect(result.done).toBe(1);
		expect(result.failed).toBe(0);

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.title).toBe("产品经理");
		expect(row.email).toBe("wang@example.com");
		expect(row.lastResearchedAt).not.toBeNull();

		const facts = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(facts).toHaveLength(2);
		for (const fact of facts) {
			expect(fact.status).toBe("applied");
			expect(fact.source).toBe("agent");
			expect(fact.evidence).toBeTruthy();
		}

		const [task] = await db().select().from(agentTasks).where(eq(agentTasks.id, taskId ?? ""));
		expect(task.status).toBe("done");
		expect(task.finishedAt).not.toBeNull();
	});

	test("人工已填职位时研究只生成建议，不覆盖", async () => {
		const contact = await contactFixture({ title: "A", notes: "职位 B" });

		stub = await startStubModel([
			{
				toolCalls: [
					{
						name: "record_fact",
						args: {
							contact_id: contact.id,
							field: "title",
							value: "B",
							evidence: [{ kind: "crm.note", quote: "职位 B", ref: contact.id }],
							source: "agent",
						},
					},
				],
			},
			{ content: "字段已有人工值，存为建议。" },
		]);
		useAgentEnv(stub.baseUrl);

		const { enqueueResearch } = await import("../server/utils/queue");
		await enqueueResearch(contact.id, "复查到期");

		const result = await runQueueTick();
		expect(result.done).toBe(1);

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.title).toBe("A");

		const [fact] = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(fact.status).toBe("proposed");
		expect(fact.value).toBe("B");
	});

	test("研究可以安排复查，落一行未来时间的 recheck 任务", async () => {
		const contact = await contactFixture();

		stub = await startStubModel([
			{
				toolCalls: [
					{
						name: "schedule_recheck",
						args: { contact_id: contact.id, days: 7, reason: "等他回复报价" },
					},
				],
			},
			{ content: "已安排 7 天后复查。" },
		]);
		useAgentEnv(stub.baseUrl);

		const { enqueueResearch } = await import("../server/utils/queue");
		await enqueueResearch(contact.id, "新建联系人");
		await runQueueTick();

		const rows = await db().select().from(agentTasks).where(eq(agentTasks.targetId, contact.id));
		const recheck = rows.find((row) => row.kind === "recheck");

		expect(recheck).toBeDefined();
		expect(Number(recheck?.runAt)).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
	});

	test("库里没有可推断内容时记一条备注，不硬凑字段", async () => {
		const contact = await contactFixture();

		stub = await startStubModel([
			{
				toolCalls: [
					{
						name: "create_activity",
						args: {
							kind: "note",
							title: "本轮无新增证据",
							contact_id: contact.id,
						},
					},
				],
			},
			{ content: "没有可推断的内容。" },
		]);
		useAgentEnv(stub.baseUrl);

		const { enqueueResearch } = await import("../server/utils/queue");
		await enqueueResearch(contact.id, "新建联系人");
		const result = await runQueueTick();

		expect(result.done).toBe(1);

		const facts = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(facts).toHaveLength(0);

		const { activities } = await import("../server/db/schema");
		const rows = await db().select().from(activities).where(eq(activities.contactId, contact.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe("本轮无新增证据");
	});

	test("同一个联系人不会堆叠多个在跑的 research 任务", async () => {
		const contact = await contactFixture();
		const { enqueueResearch } = await import("../server/utils/queue");

		const first = await enqueueResearch(contact.id, "第一次");
		const second = await enqueueResearch(contact.id, "第二次");

		expect(second).toBe(first);

		const rows = await db().select().from(agentTasks).where(eq(agentTasks.targetId, contact.id));
		expect(rows).toHaveLength(1);
	});
});

describe("公司后台研究（FR-5 与公司事实通道合流）", () => {
	test("公司研究把备注原文里的行业与地址写成公司字段并留证据", async () => {
		const { createCompany } = await import("../server/utils/companies");
		const company = await createCompany({
			name: "深圳市天康医疗科技有限公司",
			domain: null,
			industry: null,
			address: null,
			cooperationRole: null,
			description: null,
		});

		stub = await startStubModel([
			{
				reasoning: "备注里写了行业与地址。",
				toolCalls: [
					{
						name: "record_company_fact",
						args: {
							company_id: company.id,
							field: "industry",
							value: "智能健康手表",
							evidence: [
								{ kind: "crm.note", quote: "【行业】智能健康手表", ref: company.id },
							],
							source: "agent",
						},
					},
					{
						name: "record_company_fact",
						args: {
							company_id: company.id,
							field: "address",
							value: "深圳市宝安区航城街道第三工业园普顺达科技大楼7楼",
							evidence: [
								{
									kind: "crm.note",
									quote: "【地址】深圳市宝安区航城街道第三工业园普顺达科技大楼7楼",
									ref: company.id,
								},
							],
							source: "agent",
						},
					},
				],
			},
			{ content: "公司字段已补全。" },
		]);
		useAgentEnv(stub.baseUrl);

		const { enqueueCompanyResearch } = await import("../server/utils/queue");
		await enqueueCompanyResearch(company.id, "新建公司，自动触发一次后台研究。");

		const result = await runQueueTick();
		expect(result.done).toBe(1);

		const [row] = await db().select().from(companies).where(eq(companies.id, company.id));
		expect(row.industry).toBe("智能健康手表");
		expect(row.address).toContain("普顺达");

		const facts = await db().select().from(companyFacts).where(eq(companyFacts.companyId, company.id));
		expect(facts).toHaveLength(2);
		for (const fact of facts) {
			expect(fact.status).toBe("applied");
			expect(fact.source).toBe("agent");
			expect(fact.evidence).toBeTruthy();
		}
	});

	test("资料里出现库里没有的字段时，研究用它提议新字段而不是硬塞", async () => {
		const contact = await contactFixture({ notes: "客户等级：A 类，年采购量约 5 万台" });

		stub = await startStubModel([
			{
				toolCalls: [
					{
						name: "propose_field",
						args: {
							scope: "contact",
							subject_id: contact.id,
							label: "客户等级",
							sample_value: "A 类",
							evidence: [
								{ kind: "crm.note", quote: "客户等级：A 类", ref: contact.id },
							],
						},
					},
				],
			},
			{ content: "已提交新字段建议。" },
		]);
		useAgentEnv(stub.baseUrl);

		const { enqueueResearch } = await import("../server/utils/queue");
		await enqueueResearch(contact.id, "新建联系人");
		const result = await runQueueTick();

		expect(result.done).toBe(1);

		const defs = await db().select().from(fieldDefs).where(eq(fieldDefs.scope, "contact"));
		const proposed = defs.find((def) => def.label === "客户等级");

		expect(proposed?.status).toBe("proposed");
		expect(proposed?.sampleValue).toBe("A 类");
		expect(proposed?.sampleRef).toBe(contact.id);
		expect(proposed?.origin).toBe("agent");
	});

	test("ensure_company 建空壳后研究可以继续补字段，重复调用不会建第二条", async () => {		const { ensureCompany, findCompanyByName } = await import("../server/utils/companies");

		const first = await ensureCompany("深圳市天康医疗科技有限公司");
		const second = await ensureCompany("深圳市天康医疗科技有限公司");

		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		expect(second.id).toBe(first.id);

		const found = await findCompanyByName("深圳市天康医疗科技有限公司");
		expect(found?.source).toBe("agent");
	});
});
