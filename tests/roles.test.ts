import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { companies, contactFacts, contacts } from "../server/db/schema";
import { closeDb, db } from "../server/utils/db";
import { createCompany } from "../server/utils/companies";
import { createContact } from "../server/utils/contacts";
import { recordFact } from "../server/utils/facts";
import { recordCompanyFact } from "../server/utils/company-facts";
import { addFieldOption, findFieldDef, listFieldDefs } from "../server/utils/fields";
import { roleClassifier } from "../agent/role-classifier";
import { crmTools } from "../agent/tools";
import { evidence, resetDatabase, useAgentEnv } from "./helpers";
import { startStubModel, type StubModel } from "./stub-model";

let stub: StubModel | null = null;

beforeEach(async () => {
	await resetDatabase();
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

function contactInput(overrides: Record<string, unknown> = {}) {
	return {
		firstName: "古庆河",
		lastName: null,
		title: null,
		email: null,
		phone: null,
		wechatId: null,
		address: null,
		businessRole: null,
		linkedin: null,
		github: null,
		notes: null,
		companyId: null,
		...overrides,
	} as Parameters<typeof createContact>[0];
}

function companyInput(overrides: Record<string, unknown> = {}) {
	return {
		name: "深圳市天康医疗科技有限公司",
		domain: null,
		industry: null,
		address: null,
		cooperationRole: null,
		description: null,
		...overrides,
	} as Parameters<typeof createCompany>[0];
}

async function runClassifyRole(input: Record<string, unknown>) {
	const tools = crmTools();
	const tool = tools.classify_role as unknown as {
		execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
	};

	return tool.execute(input);
}

describe("合作角色与业务角色：默认标签与增量标签", () => {
	test("公司默认客户与供应商，联系人默认对接人决策人技术老板采购", async () => {
		const company = await findFieldDef({ scope: "company", term: "合作角色" });
		const contact = await findFieldDef({ scope: "contact", term: "业务角色" });

		expect(company?.key).toBe("cooperation_role");
		expect(company?.options).toEqual(["客户", "供应商"]);
		expect(company?.dataType).toBe("enum");

		expect(contact?.key).toBe("business_role");
		expect(contact?.options).toEqual(["对接人", "决策人", "技术", "老板", "采购"]);
	});

	test("选项表里没有写死的「其他」，新标签靠增量维护", async () => {
		const company = await findFieldDef({ scope: "company", term: "合作角色" });
		const contact = await findFieldDef({ scope: "contact", term: "业务角色" });

		expect(company?.options).not.toContain("其他");
		expect(contact?.options).not.toContain("其他");

		await addFieldOption({ scope: "company", key: "cooperation_role", value: "渠道商" });
		await addFieldOption({ scope: "contact", key: "business_role", value: "助理" });

		const companyAfter = await findFieldDef({ scope: "company", term: "合作角色" });
		const contactAfter = await findFieldDef({ scope: "contact", term: "业务角色" });

		expect(companyAfter?.options).toEqual(["客户", "供应商", "渠道商"]);
		expect(contactAfter?.options).toEqual(["对接人", "决策人", "技术", "老板", "采购", "助理"]);
	});
});

describe("分类器：命中已有、落到其他、新标签", () => {
	test("命中已有标签：写入公司合作角色，字段与事实同时更新", async () => {
		const company = await createCompany(companyInput());

		stub = await startStubModel([
			{
				content:
					'{"decision":"existing","value":"供应商","reason":"资料写明是源头厂家，供货方"}',
			},
		]);
		useAgentEnv(stub.baseUrl);

		const result = await runClassifyRole({
			scope: "company",
			subject_id: company.id,
			text: "【公司】深圳市天康医疗科技有限公司，源头厂家生产销售智能手表",
			evidence: [evidence("crm.activity", "源头厂家生产销售智能手表", company.id)],
		});

		expect(result.applied).toBe(true);

		const [row] = await db().select().from(companies).where(eq(companies.id, company.id));
		expect(row.cooperationRole).toBe("供应商");
	});

	test("落到其他：什么都不写", async () => {
		const contact = await createContact(contactInput());

		stub = await startStubModel([
			{ content: '{"decision":"other","value":"","reason":"资料只写了姓名与电话"}' },
		]);
		useAgentEnv(stub.baseUrl);

		const result = await runClassifyRole({
			scope: "contact",
			subject_id: contact.id,
			text: "【姓名】古庆河 【手机】18929345383",
			evidence: [evidence("crm.activity", "【姓名】古庆河", contact.id)],
		});

		expect(result.written).toBe(false);
		expect(result.outcome).toBe("other");

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.businessRole).toBeNull();
	});

	test("资料写出新角色：新增标签并写入联系人业务角色", async () => {
		const contact = await createContact(contactInput());

		stub = await startStubModel([
			{ content: '{"decision":"new","value":"助理","reason":"资料写明他是老板的助理"}' },
		]);
		useAgentEnv(stub.baseUrl);

		const result = await runClassifyRole({
			scope: "contact",
			subject_id: contact.id,
			text: "古庆河是李总的助理，负责对接",
			evidence: [evidence("crm.activity", "古庆河是李总的助理", contact.id)],
		});

		expect(result.applied).toBe(true);

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.businessRole).toBe("助理");

		const def = await findFieldDef({ scope: "contact", term: "business_role" });
		expect(def?.options).toContain("助理");
	});

	test("分类器不可用时一个值都不写，并说明原因", async () => {
		delete process.env.ZAI_API_KEY;
		const company = await createCompany(companyInput());

		const decision = await roleClassifier().classify({
			scope: "company",
			label: "合作角色",
			text: "源头厂家",
			options: ["客户", "供应商"],
		});

		expect(decision.kind).toBe("unavailable");

		const result = await runClassifyRole({
			scope: "company",
			subject_id: company.id,
			text: "源头厂家",
			evidence: [evidence("crm.activity", "源头厂家", company.id)],
		});

		expect(result.written).toBe(false);

		const [row] = await db().select().from(companies).where(eq(companies.id, company.id));
		expect(row.cooperationRole).toBeNull();
	});

	test("人工已定角色时，分类结果只变成建议，不覆盖", async () => {
		const company = await createCompany(companyInput({ cooperationRole: "客户" }));

		stub = await startStubModel([
			{ content: '{"decision":"existing","value":"供应商","reason":"源头厂家"}' },
		]);
		useAgentEnv(stub.baseUrl);

		const result = await runClassifyRole({
			scope: "company",
			subject_id: company.id,
			text: "源头厂家生产销售智能手表",
			evidence: [evidence("crm.activity", "源头厂家生产销售智能手表", company.id)],
		});

		expect(result.applied).toBe(false);
		expect(result.status).toBe("proposed");

		const [row] = await db().select().from(companies).where(eq(companies.id, company.id));
		expect(row.cooperationRole).toBe("客户");
	});
});

describe("角色字段仍守证据铁律", () => {
	test("智能体直接手写角色时同样要求证据，且不能越过拒绝记录", async () => {
		const contact = await createContact(contactInput());

		const noEvidence = await recordFact({
			contactId: contact.id,
			field: "业务角色",
			value: "决策人",
			evidence: [],
			source: "agent",
		});
		expect(noEvidence.stored).toBe(false);

		const written = await recordFact({
			contactId: contact.id,
			field: "业务角色",
			value: "决策人",
			evidence: [evidence("crm.activity", "他说了算", contact.id)],
			source: "agent",
		});
		expect(written.applied).toBe(true);

		const facts = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(facts[0].field).toBe("business_role");
	});

	test("公司角色字段同样可通过事实通道写入并留证据", async () => {
		const company = await createCompany(companyInput());

		const result = await recordCompanyFact({
			companyId: company.id,
			field: "合作角色",
			value: "供应商",
			evidence: [evidence("crm.activity", "源头厂家", company.id)],
			source: "agent",
		});

		expect(result.applied).toBe(true);

		const defs = await listFieldDefs({ scope: "company", status: "active" });
		expect(defs.some((def) => def.key === "cooperation_role")).toBe(true);
	});
});
