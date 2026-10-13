import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { companies, companyFacts, contacts } from "../server/db/schema";
import { closeDb, db } from "../server/utils/db";
import { recordFact } from "../server/utils/facts";
import {
	acceptCompanyFact,
	companyFactsFor,
	dismissCompanyFact,
	recordCompanyFact,
} from "../server/utils/company-facts";
import { createCompany } from "../server/utils/companies";
import { evidence, resetDatabase } from "./helpers";

beforeEach(async () => {
	await resetDatabase();
});

afterAll(async () => {
	await closeDb();
});

async function companyFixture(input: { name?: string; industry?: string | null } = {}) {
	return createCompany({
		name: input.name ?? "深圳市天康医疗科技有限公司",
		domain: null,
		industry: input.industry ?? null,
		address: null,
		cooperationRole: null,
		description: null,
	});
}

async function factRow(companyId: string) {
	return db().select().from(companyFacts).where(eq(companyFacts.companyId, companyId));
}

describe("公司事实通道：三条铁律与联系人通道一致", () => {
	test("空字段 + 证据达标：直接写入公司字段并留下证据", async () => {
		const company = await companyFixture();

		const result = await recordCompanyFact({
			companyId: company.id,
			field: "industry",
			value: "智能健康手表",
			evidence: [evidence("crm.activity", "行业：智能健康手表", company.id)],
			source: "agent",
		});

		expect(result.stored).toBe(true);
		expect(result.applied).toBe(true);

		const [row] = await db().select().from(companies).where(eq(companies.id, company.id));
		expect(row.industry).toBe("智能健康手表");

		const [fact] = await factRow(company.id);
		expect(fact.status).toBe("applied");
		expect(fact.source).toBe("agent");
		expect(fact.evidence).toEqual([evidence("crm.activity", "行业：智能健康手表", company.id)]);
	});

	test("人工已填行业时不覆盖，改为建议", async () => {
		const company = await companyFixture({ industry: "医疗器械" });

		const result = await recordCompanyFact({
			companyId: company.id,
			field: "industry",
			value: "智能健康手表",
			evidence: [evidence("crm.activity", "行业：智能健康手表", company.id)],
			source: "agent",
		});

		expect(result.applied).toBe(false);
		expect(result.status).toBe("proposed");

		const [row] = await db().select().from(companies).where(eq(companies.id, company.id));
		expect(row.industry).toBe("医疗器械");
	});

	test("拒绝过的值不再提，包括 URL 的另一种写法", async () => {
		const company = await createCompany({
			name: "深圳市天康医疗科技有限公司",
			domain: "tiankang.cn",
			industry: null,
			address: null,
			cooperationRole: null,
			description: null,
		});

		const proposed = await recordCompanyFact({
			companyId: company.id,
			field: "domain",
			value: "https://www.tiankang.com/",
			evidence: [evidence("crm.activity", "官网 tiankang.com", company.id)],
			source: "agent",
		});
		expect(proposed.status).toBe("proposed");

		const [fact] = await factRow(company.id);
		const dismissed = await dismissCompanyFact(fact.id);
		expect(dismissed.ok).toBe(true);

		const again = await recordCompanyFact({
			companyId: company.id,
			field: "domain",
			value: "HTTPS://tiankang.com/?utm=1",
			evidence: [evidence("crm.activity", "官网 tiankang.com", company.id)],
			source: "agent",
		});

		expect(again.stored).toBe(false);
		expect(again.reason).toContain("已被拒绝");
	});

	test("没有证据不写；公司不存在不写", async () => {
		const company = await companyFixture();

		const noEvidence = await recordCompanyFact({
			companyId: company.id,
			field: "description",
			value: "源头厂家",
			evidence: [],
			source: "agent",
		});
		expect(noEvidence.stored).toBe(false);
		expect(noEvidence.reason).toContain("没有一手来源");

		const missing = await recordCompanyFact({
			companyId: "not-a-company",
			field: "description",
			value: "源头厂家",
			evidence: [evidence()],
			source: "agent",
		});
		expect(missing.stored).toBe(false);
	});

	test("接受建议后写入公司字段，同字段其它建议自动关闭", async () => {
		const company = await createCompany({
			name: "深圳市天康医疗科技有限公司",
			domain: null,
			industry: null,
			address: "深圳市宝安区航城街道第三工业园",
			cooperationRole: null,
			description: null,
		});

		const first = await recordCompanyFact({
			companyId: company.id,
			field: "address",
			value: "深圳市宝安区航城街道普顺达科技大楼7楼",
			evidence: [evidence("crm.activity", "地址：普顺达科技大楼7楼", company.id)],
			source: "agent",
		});
		expect(first.status).toBe("proposed");

		const factsBefore = await factRow(company.id);
		const accepted = await acceptCompanyFact(factsBefore[0].id);
		expect(accepted.ok).toBe(true);

		const [row] = await db().select().from(companies).where(eq(companies.id, company.id));
		expect(row.address).toContain("普顺达");

		const facts = await companyFactsFor(company.id);
		expect(facts[0].status).toBe("applied");
	});
});

describe("联系人地址字段", () => {
	test("地址可作为事实字段带证据写入联系人", async () => {
		const { createContact } = await import("../server/utils/contacts");
		const contact = await createContact({
			firstName: "古庆河",
			lastName: null,
			title: null,
			email: null,
			phone: null,
			wechatId: null,
			address: null,
			businessRole: null,
			relationshipState: null,
			repairNote: null,
			linkedin: null,
			github: null,
			notes: "【地址】深圳市宝安区航城街道普顺达科技大楼7楼",
			companyId: null,
		});

		const result = await recordFact({
			contactId: contact.id,
			field: "address",
			value: "深圳市宝安区航城街道普顺达科技大楼7楼",
			evidence: [evidence("crm.note", "【地址】深圳市宝安区航城街道普顺达科技大楼7楼", contact.id)],
			source: "agent",
		});

		expect(result.applied).toBe(true);

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.address).toContain("普顺达");
	});
});
