import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { ensureContact, linkContactCompany, getContact } from "../server/utils/contacts";
import { createCompany } from "../server/utils/companies";
import { closeDb } from "../server/utils/db";
import { crmTools } from "../agent/tools";
import { contactFixture, resetDatabase } from "./helpers";

beforeEach(async () => {
	await resetDatabase();
});

afterAll(async () => {
	await closeDb();
});

describe("ensure_contact：按微信号 → 电话 → 姓名去重建档", () => {
	test("库里没有人时新建，并只填提供的键", async () => {
		const result = await ensureContact({
			name: "许东明",
			wechatId: "许东明",
			phone: "19924544039",
		});

		expect(result.created).toBe(true);
		expect(result.matchedBy).toBeNull();
		expect(result.name).toBe("许东明");

		const detail = await crmTools().read_contact.execute!({ contact_id: result.id }, {} as never);
		const payload = detail as Record<string, unknown>;
		const contact = payload.contact as Record<string, unknown>;

		expect(contact.name).toBe("许东明");
		expect(contact.wechat_id).toBe("许东明");
		expect(contact.phone).toBe("19924544039");
		expect(contact.title).toBeNull();
	});

	test("微信号命中既有联系人时不重复建", async () => {
		const existing = await contactFixture({ firstName: "许东明", wechatId: "许东明" });

		const result = await ensureContact({
			name: "许东明",
			wechatId: "许东明",
			phone: null,
		});

		expect(result.created).toBe(false);
		expect(result.matchedBy).toBe("wechat_id");
		expect(result.id).toBe(existing.id);
	});

	test("电话命中，即使姓名写法不同", async () => {
		const existing = await contactFixture({ firstName: "许东明", phone: "19924544039" });

		const result = await ensureContact({
			name: "许总",
			wechatId: "翔铭达智能健康手表",
			phone: "19924544039",
		});

		expect(result.created).toBe(false);
		expect(result.matchedBy).toBe("phone");
		expect(result.id).toBe(existing.id);
	});

	test("电话带分隔符也能命中", async () => {
		const existing = await contactFixture({ firstName: "许东明", phone: "199-2454-4039" });

		const result = await ensureContact({
			name: "许东明",
			wechatId: null,
			phone: "19924544039",
		});

		expect(result.created).toBe(false);
		expect(result.matchedBy).toBe("phone");
		expect(result.id).toBe(existing.id);
	});

	test("只有姓名相同时也命中，不重复建", async () => {
		const existing = await contactFixture({ firstName: "许东明" });

		const result = await ensureContact({
			name: "许东明",
			wechatId: null,
			phone: null,
		});

		expect(result.created).toBe(false);
		expect(result.matchedBy).toBe("name");
		expect(result.id).toBe(existing.id);
	});

	test("已归档的联系人不参与去重，会新建一条", async () => {
		const archived = await contactFixture({ firstName: "许东明" });
		const { archiveContact } = await import("../server/utils/contacts");
		await archiveContact(archived.id);

		const result = await ensureContact({ name: "许东明", wechatId: null, phone: null });

		expect(result.created).toBe(true);
		expect(result.id).not.toBe(archived.id);
	});

	test("去重顺序：微信号优先于电话", async () => {
		const byWechat = await contactFixture({ firstName: "甲", wechatId: "wechat-A" });
		const byPhone = await contactFixture({ firstName: "乙", phone: "13800000000" });

		const result = await ensureContact({
			name: "丙",
			wechatId: "wechat-A",
			phone: "13800000000",
		});

		expect(result.id).toBe(byWechat.id);
		expect(result.matchedBy).toBe("wechat_id");
		expect(byPhone.id).not.toBe(result.id);
	});
});

describe("link_contact_company：只在没有归属时写", () => {
	test("联系人没有公司时建立归属", async () => {
		const contact = await contactFixture({ firstName: "许东明" });
		const company = await createCompany({ name: "深圳市领健（翔铭达）科技有限公司" } as never);

		const result = await linkContactCompany({ contactId: contact.id, companyId: company.id });

		expect(result.linked).toBe(true);

		const after = await getContact(contact.id);
		expect(after?.companyId).toBe(company.id);
	});

	test("已有归属时不改挂，返回原因", async () => {
		const companyA = await createCompany({ name: "甲公司" } as never);
		const companyB = await createCompany({ name: "乙公司" } as never);
		const contact = await contactFixture({ firstName: "许东明", companyId: companyA.id });

		const result = await linkContactCompany({ contactId: contact.id, companyId: companyB.id });

		expect(result.linked).toBe(false);
		expect(result.previousCompanyId).toBe(companyA.id);

		const after = await getContact(contact.id);
		expect(after?.companyId).toBe(companyA.id);
	});

	test("已归属同一家公司时返回未改动", async () => {
		const company = await createCompany({ name: "甲公司" } as never);
		const contact = await contactFixture({ firstName: "许东明", companyId: company.id });

		const result = await linkContactCompany({ contactId: contact.id, companyId: company.id });

		expect(result.linked).toBe(false);
		expect(result.reason).toContain("本来就在");
	});

	test("公司 id 不存在时不写", async () => {
		const contact = await contactFixture({ firstName: "许东明" });

		const result = await linkContactCompany({ contactId: contact.id, companyId: "not-exist-id" });

		expect(result.linked).toBe(false);
		expect(result.reason).toContain("公司不存在");

		const after = await getContact(contact.id);
		expect(after?.companyId).toBeNull();
	});

	test("工具层暴露 link_contact_company 且入参需要两个 id", async () => {
		const tool = crmTools().link_contact_company as unknown as {
			inputSchema: { safeParse: (value: unknown) => { success: boolean } };
		};

		expect(tool.inputSchema.safeParse({ contact_id: "a", company_id: "b" }).success).toBe(true);
		expect(tool.inputSchema.safeParse({ contact_id: "a" }).success).toBe(false);
	});
});

describe("ensure_contact 工具：守证据铁律", () => {
	test("没有证据时工具入参校验失败", async () => {
		const tool = crmTools().ensure_contact as unknown as {
			inputSchema: { safeParse: (value: unknown) => { success: boolean } };
		};

		const parsed = tool.inputSchema.safeParse({ name: "许东明", evidence: [] });
		expect(parsed.success).toBe(false);
	});

	test("带证据调用返回新建结果与提示", async () => {
		const tool = crmTools().ensure_contact as unknown as {
			execute: (args: Record<string, unknown>, options: never) => Promise<Record<string, unknown>>;
		};

		const result = await tool.execute(
			{
				name: "许东明",
				wechat_id: "许东明",
				phone: "19924544039",
				evidence: [
					{
						kind: "wechat.chat",
						quote: "【姓名】许东明 【电话】19924544039",
						ref: "许东明@聊天记录.txt",
					},
				],
			},
			{} as never,
		);

		expect(result.created).toBe(true);
		expect(result.matched_by).toBeNull();
		expect(typeof result.note).toBe("string");
	});
});
