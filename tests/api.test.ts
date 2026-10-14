import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resetDatabase } from "./helpers";

const projectRoot = resolve(import.meta.dir, "..");
const entry = resolve(projectRoot, ".output", "server", "index.mjs");
const PORT = 3211;
const base = `http://127.0.0.1:${PORT}`;
const built = existsSync(entry);

let server: ChildProcess | null = null;

async function waitForServer(): Promise<void> {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response = await fetch(`${base}/api/status`);

			if (response.ok) return;
		} catch {
			await Bun.sleep(500);
		}
	}

	throw new Error("服务器未能在 30 秒内启动。");
}

async function post(path: string, body: unknown) {
	const response = await fetch(`${base}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

async function get(path: string) {
	const response = await fetch(`${base}${path}`);

	return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
	if (!built) return;

	await resetDatabase();

	server = spawn(process.execPath, [entry], {
		cwd: projectRoot,
		env: {
			...process.env,
			PORT: String(PORT),
			HOST: "127.0.0.1",
			ZAI_API_KEY: "",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	await waitForServer();
}, 60000);

afterAll(async () => {
	if (server) {
		server.kill();
		await Bun.sleep(500);
	}
});

describe.skipIf(!built)("M1 验收：三模块 CRUD、子串搜索、首页三块", () => {
	test("新建联系人 10 秒内出现在列表，并可直接进详情", async () => {
		const started = Date.now();
		const created = await post("/api/contacts", {
			firstName: "王小明",
			title: "产品经理",
			email: "wang@example.com",
			wechatId: "wangxm",
		});

		expect(created.status).toBe(200);

		const list = await get("/api/contacts?q=王小明");
		expect(list.status).toBe(200);

		const items = list.payload.items as { id: string; firstName: string }[];
		expect(items).toHaveLength(1);
		expect(Date.now() - started).toBeLessThan(10_000);

		const detail = await get(`/api/contacts/${items[0].id}`);
		expect(detail.status).toBe(200);
		expect((detail.payload.contact as { title: string }).title).toBe("产品经理");
	});

	test('搜索"王"只返回含"王"的记录，不做近似扩展', async () => {
		await post("/api/contacts", { firstName: "张伟", email: "zhang@example.com" });
		await post("/api/contacts", { firstName: "李王", email: "liw@example.com" });
		await post("/api/contacts", { firstName: "王芳", wechatId: "wangfang" });

		const list = await get("/api/contacts?q=王");
		const names = (list.payload.items as { firstName: string }[])
			.map((item) => item.firstName)
			.sort();

		expect(names).toEqual(["李王", "王小明", "王芳"]);
		expect(names).not.toContain("张伟");

		const miss = await get("/api/contacts?q=汪");
		expect((miss.payload.items as unknown[]).length).toBe(0);
	});

	test("逾期任务出现在首页并可勾选完成（FR-3）", async () => {
		const contact = await post("/api/contacts", { firstName: "任务对象" });
		const contactId = (contact.payload.contact as { id: string }).id;
		const yesterday = Date.now() - 24 * 60 * 60 * 1000;

		const created = await post("/api/activities", {
			kind: "task",
			title: "回访报价",
			contactId,
			dueAt: yesterday,
		});
		expect(created.status).toBe(200);

		const before = await get("/api/dashboard");
		const tasks = before.payload.tasks as { id: string; title: string }[];
		expect(tasks.some((task) => task.title === "回访报价")).toBe(true);

		const activityId = (created.payload.activity as { id: string }).id;
		const done = await post("/api/activity-decision", { id: activityId, action: "complete" });
		expect(done.status).toBe(200);

		const after = await get("/api/dashboard");
		const remaining = after.payload.tasks as { title: string }[];
		expect(remaining.some((task) => task.title === "回访报价")).toBe(false);
	});

	test("首页数据只有三块：商机、逾期任务、近期活动", async () => {
		const dashboard = await get("/api/dashboard");

		expect(Object.keys(dashboard.payload).sort()).toEqual(["activities", "deals", "tasks"]);
	});

	test("商机六阶段可用，阶段变更写入活动；接口不接受金额字段", async () => {
		const company = await post("/api/companies", { name: "示例科技" });
		const companyId = (company.payload.company as { id: string }).id;

		const deal = await post("/api/deals", {
			name: "示例科技 · 首单",
			companyId,
			stage: "初步接触",
			expectedCloseDate: "2026-12-01",
			amount: 999999,
		});
		expect(deal.status).toBe(200);

		const dealId = (deal.payload.deal as { id: string }).id;

		for (const stage of ["需求确认", "方案报价", "谈判", "成交"]) {
			const changed = await post(`/api/deals/${dealId}`, { action: "stage", stage });
			expect(changed.status).toBe(200);
		}

		const detail = await get(`/api/deals/${dealId}`);
		const payload = detail.payload as unknown as {
			deal: { stage: string; status: string };
			activities: { kind: string; title: string }[];
		};

		expect(payload.deal.stage).toBe("成交");
		expect(payload.deal.status).toBe("won");
		expect(payload.activities.filter((item) => item.kind === "stage_change")).toHaveLength(4);
		expect(JSON.stringify(payload)).not.toContain("amount");
		expect(JSON.stringify(payload)).not.toContain("999999");
	});

	test("归档后从列表消失，可按归档查询", async () => {
		const created = await post("/api/contacts", { firstName: "待归档" });
		const id = (created.payload.contact as { id: string }).id;

		const archived = await fetch(`${base}/api/contacts/${id}`, { method: "DELETE" });
		expect(archived.status).toBe(200);

		const list = await get("/api/contacts?q=待归档");
		expect((list.payload.items as unknown[]).length).toBe(0);

		const archivedList = await get("/api/contacts?q=待归档&archived=true");
		expect((archivedList.payload.items as unknown[]).length).toBe(1);
	});

	test("界面为简体中文，且没有任何金额或登录字样", async () => {
		const page = await fetch(`${base}/`);

		expect(page.status).toBe(200);

		const html = await page.text();
		// 首页现在是四象限看板：商机与任务都在格子里，不再是各自一块。
		expect(html).toContain("紧急且重要");
		expect(html).toContain("不重要不紧急");
		expect(html).toContain("近期活动");
		expect(html.includes("金额")).toBe(false);
		expect(html.includes("登录")).toBe(false);
		expect(html.toLowerCase().includes("amount")).toBe(false);
	});
});

describe.skipIf(!built)("地址与公司字段建议（B + C）", () => {
	test("联系人地址可录入并在详情返回", async () => {
		const created = await post("/api/contacts", {
			firstName: "古庆河",
			phone: "18929345383",
			address: "深圳市宝安区航城街道第三工业园普顺达科技大楼7楼",
		});
		expect(created.status).toBe(200);

		const contactId = (created.payload.contact as { id: string }).id;
		const detail = await get(`/api/contacts/${contactId}`);
		const contact = (detail.payload as unknown as { contact: { address: string | null } }).contact;

		expect(contact.address).toContain("普顺达");
	});

	test("公司行业与地址可录入，字段建议可接受并写回字段", async () => {
		const created = await post("/api/companies", {
			name: "深圳市天康医疗科技有限公司",
			industry: "医疗器械",
			address: "深圳市宝安区航城街道第三工业园",
		});
		expect(created.status).toBe(200);

		const companyId = (created.payload.company as { id: string }).id;
		const before = await get(`/api/companies/${companyId}`);
		const companyBefore = (before.payload as unknown as { company: { industry: string } }).company;
		expect(companyBefore.industry).toBe("医疗器械");

		const { recordCompanyFact } = await import("../server/utils/company-facts");
		const proposed = await recordCompanyFact({
			companyId,
			field: "industry",
			value: "智能健康手表",
			evidence: [{ kind: "crm.note", quote: "【行业】智能健康手表", ref: companyId }],
			source: "agent",
		});
		expect(proposed.status).toBe("proposed");

		const withFact = await get(`/api/companies/${companyId}`);
		const facts = (withFact.payload as unknown as { facts: { id: string; status: string }[] }).facts;
		expect(facts).toHaveLength(1);
		expect(facts[0].status).toBe("proposed");

		const decided = await post("/api/fact-decision", {
			id: facts[0].id,
			action: "accept",
			subject: "company",
		});
		expect(decided.status).toBe(200);

		const after = await get(`/api/companies/${companyId}`);
		const companyAfter = (
			after.payload as unknown as { company: { industry: string }; facts: { status: string }[] }
		).company;

		expect(companyAfter.industry).toBe("智能健康手表");
	});

	test("拒绝公司建议后同一个值不再出现", async () => {
		const created = await post("/api/companies", {
			name: "深圳市天康医疗科技有限公司",
			industry: "医疗器械",
			address: null,
			description: "医疗器械销售",
		});
		const companyId = (created.payload.company as { id: string }).id;

		const { recordCompanyFact } = await import("../server/utils/company-facts");
		await recordCompanyFact({
			companyId,
			field: "description",
			value: "源头厂家生产销售智能手表",
			evidence: [{ kind: "crm.note", quote: "【主营介绍】源头厂家生产销售智能手表", ref: companyId }],
			source: "agent",
		});

		const withFact = await get(`/api/companies/${companyId}`);
		const facts = (withFact.payload as unknown as { facts: { id: string }[] }).facts;

		const rejected = await post("/api/fact-decision", {
			id: facts[0].id,
			action: "reject",
			subject: "company",
		});
		expect(rejected.status).toBe(200);

		const again = await recordCompanyFact({
			companyId,
			field: "description",
			value: "源头厂家生产销售智能手表",
			evidence: [{ kind: "crm.note", quote: "【主营介绍】源头厂家生产销售智能手表", ref: companyId }],
			source: "agent",
		});

		expect(again.stored).toBe(false);
	});
	test("新字段建议走接口确认后生效，示例值同时写入", async () => {
		const created = await post("/api/contacts", { firstName: "字段建议对象" });
		const contactId = (created.payload.contact as { id: string }).id;

		const { proposeField } = await import("../server/utils/fields");
		const proposed = await proposeField({
			scope: "contact",
			label: "客户等级",
			sampleValue: "A 类",
			sampleRef: contactId,
			evidence: [{ kind: "crm.note", quote: "客户等级：A 类", ref: contactId }],
		});
		expect(proposed.outcome).toBe("proposed");

		const listed = await get("/api/fields?scope=contact");
		const fields = (listed.payload as unknown as { fields: { id: string; status: string }[] }).fields;
		expect(fields.some((field) => field.status === "proposed")).toBe(true);

		const accepted = await post("/api/field-decision", { id: proposed.def.id, action: "accept" });
		expect(accepted.status).toBe(200);
		expect(accepted.payload.valueWritten).toBe(true);

		const afterFields = await get("/api/fields?scope=contact");
		const active = (afterFields.payload as unknown as { fields: { key: string; status: string }[] })
			.fields;
		expect(active.find((field) => field.key === "客户等级")?.status).toBe("active");

		const detail = await get(`/api/contacts/${contactId}`);
		const facts = (detail.payload as unknown as { facts: { field: string; value: string; status: string }[] })
			.facts;
		expect(facts.find((fact) => fact.field === "客户等级")?.value).toBe("A 类");
		expect(facts.find((fact) => fact.field === "客户等级")?.status).toBe("applied");
	});

	test("字段表的同义词去重对接口同样生效", async () => {
		const { proposeField } = await import("../server/utils/fields");
		const result = await proposeField({
			scope: "contact",
			label: "联系电话",
			sampleValue: "13800000000",
			sampleRef: null,
			evidence: [{ kind: "crm.note", quote: "联系电话：13800000000", ref: null }],
		});

		expect(result.outcome).toBe("exists");
		expect(result.outcome === "exists" ? result.def.key : "").toBe("phone");
	});
});

describe.skipIf(!built)("NFR 降级：未配置智谱密钥", () => {	test("智能体停用并在界面明示，其余接口正常", async () => {
		const status = await get("/api/status");

		expect(status.status).toBe(200);
		expect(status.payload.agentEnabled).toBe(false);
		expect(String(status.payload.agentReason)).toContain("ZAI_API_KEY");
		expect(status.payload.pending).toBe(0);

		const page = await fetch(`${base}/`);
		const html = await page.text();
		expect(html).toContain("智能体停用");
		expect(html).toContain("ZAI_API_KEY");
	});

	test("对话接口不抛错，返回停用原因", async () => {
		const response = await fetch(`${base}/api/chat`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "在吗" }),
		});

		expect(response.status).toBe(200);

		const payload = (await response.json()) as { disabled?: boolean; reason?: string };
		expect(payload.disabled).toBe(true);
		expect(String(payload.reason)).toContain("ZAI_API_KEY");
	});

	test("新建联系人不会入队（智能体停用时队列保持空）", async () => {
		const created = await post("/api/contacts", { firstName: "不入队" });
		expect(created.status).toBe(200);

		const status = await get("/api/status");
		expect(status.payload.pending).toBe(0);
	});
});
