import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { contacts, contactFacts } from "../server/db/schema";
import { db, closeDb } from "../server/utils/db";
import { acceptFact, dismissFact, recordFact, revertFact } from "../server/utils/facts";
import { canonicalValue, sameValue } from "../server/utils/fact-rules";
import { contactFixture, evidence, resetDatabase } from "./helpers";

beforeEach(async () => {
	await resetDatabase();
});

afterAll(async () => {
	await closeDb();
});

describe("FR-6 铁律一：永不覆盖人工录入的值", () => {
	test("人工填写的职位不会被研究覆盖，改为生成建议", async () => {
		const contact = await contactFixture({ title: "A" });

		const result = await recordFact({
			contactId: contact.id,
			field: "title",
			value: "B",
			evidence: [evidence("crm.note", "职位改为 B")],
			source: "agent",
		});

		expect(result.stored).toBe(true);
		expect(result.applied).toBe(false);
		expect(result.status).toBe("proposed");

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.title).toBe("A");

		const facts = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(facts).toHaveLength(1);
		expect(facts[0].status).toBe("proposed");
		expect(facts[0].value).toBe("B");
	});

	test("字段为空且证据达标时直接写入，并留下证据与来源", async () => {
		const contact = await contactFixture();

		const result = await recordFact({
			contactId: contact.id,
			field: "title",
			value: "产品经理",
			evidence: [evidence("crm.note", "王小明，产品经理")],
			source: "agent",
		});

		expect(result.stored).toBe(true);
		expect(result.applied).toBe(true);

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.title).toBe("产品经理");

		const [fact] = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(fact.status).toBe("applied");
		expect(fact.source).toBe("agent");
		expect(fact.evidence).toEqual([evidence("crm.note", "王小明，产品经理")]);
	});

	test("被人工接受过的值视为人工值，agent 再提新值只生成建议", async () => {
		const contact = await contactFixture();
		const applied = await recordFact({
			contactId: contact.id,
			field: "email",
			value: "a@example.com",
			evidence: [evidence("crm.note", "邮箱 a@example.com")],
			source: "agent",
		});
		expect(applied.applied).toBe(true);

		const [fact] = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		await acceptFact(fact.id);

		await db()
			.update(contacts)
			.set({ email: "human@example.com" })
			.where(eq(contacts.id, contact.id));

		const result = await recordFact({
			contactId: contact.id,
			field: "email",
			value: "agent@example.com",
			evidence: [evidence("crm.note", "邮箱 agent@example.com")],
			source: "agent",
		});

		expect(result.applied).toBe(false);
		expect(result.status).toBe("proposed");
	});
});

describe("FR-6 铁律二：同一值被拒绝后不再重复建议", () => {
	test("拒绝建议 B 之后再研究不重现 B", async () => {
		const contact = await contactFixture({ title: "A" });

		const first = await recordFact({
			contactId: contact.id,
			field: "title",
			value: "B",
			evidence: [evidence("crm.note", "职位 B")],
			source: "agent",
		});
		expect(first.status).toBe("proposed");

		const [fact] = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		const dismissed = await dismissFact(fact.id);
		expect(dismissed.ok).toBe(true);

		const second = await recordFact({
			contactId: contact.id,
			field: "title",
			value: "B",
			evidence: [evidence("crm.note", "职位 B")],
			source: "agent",
		});

		expect(second.stored).toBe(false);
		expect(second.reason).toContain("已被拒绝");

		const facts = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(facts).toHaveLength(1);
	});

	test("归一化比较：URL 大小写、www、尾斜杠、查询串视为同值", () => {
		expect(sameValue("HTTPS://WWW.Example.com/Path/", "https://example.com/Path")).toBe(true);
		expect(sameValue("https://example.com/p?utm=1", "http://www.example.com/p/")).toBe(true);
		expect(sameValue("  张三  ", "张三")).toBe(true);
		expect(sameValue("张三", "李四")).toBe(false);
		expect(canonicalValue("HTTPS://WWW.Example.com/Path/?a=1")).toBe("example.com/path");
	});

	test("被拒绝的是 URL 的另一种写法时同样不再提", async () => {
		const contact = await contactFixture();

		await recordFact({
			contactId: contact.id,
			field: "linkedin",
			value: "https://www.linkedin.com/in/wang/",
			evidence: [evidence("crm.note", "领英 https://www.linkedin.com/in/wang/")],
			source: "agent",
		});

		const [fact] = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		await dismissFact(fact.id);

		const again = await recordFact({
			contactId: contact.id,
			field: "linkedin",
			value: "HTTPS://linkedin.com/in/wang/?trk=abc",
			evidence: [evidence("crm.note", "领英主页")],
			source: "agent",
		});

		expect(again.stored).toBe(false);
	});
});

describe("FR-6 铁律三：没有一手来源不写", () => {
	test("缺少证据时拒绝写入", async () => {
		const contact = await contactFixture();

		const result = await recordFact({
			contactId: contact.id,
			field: "phone",
			value: "13800000000",
			evidence: [],
			source: "agent",
		});

		expect(result.stored).toBe(false);
		expect(result.reason).toContain("没有一手来源");

		const facts = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(facts).toHaveLength(0);
	});

	test("空值拒绝写入", async () => {
		const contact = await contactFixture();

		const result = await recordFact({
			contactId: contact.id,
			field: "phone",
			value: "   ",
			evidence: [evidence()],
			source: "agent",
		});

		expect(result.stored).toBe(false);
	});
});

describe("FR-6 建议的接受与冲突关闭", () => {
	test("接受建议后字段更新，同字段其它待确认建议自动关闭", async () => {
		const contact = await contactFixture({ title: "A" });

		await recordFact({
			contactId: contact.id,
			field: "title",
			value: "B",
			evidence: [evidence("crm.note", "职位 B")],
			source: "agent",
		});
		await recordFact({
			contactId: contact.id,
			field: "title",
			value: "C",
			evidence: [evidence("crm.note", "职位 C")],
			source: "agent",
		});

		const proposed = await db()
			.select()
			.from(contactFacts)
			.where(eq(contactFacts.contactId, contact.id));
		expect(proposed).toHaveLength(2);

		const target = proposed.find((fact) => fact.value === "B");
		const accepted = await acceptFact(target?.id ?? "");
		expect(accepted.ok).toBe(true);

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.title).toBe("B");

		const after = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		const statuses = after.map((fact) => `${fact.value}:${fact.status}`).sort();
		expect(statuses).toEqual(["B:applied", "C:superseded"]);
	});
});

describe("同值去重与撤销", () => {
	test("字段现值已有同文（人工填的列值）时，再提同值直接拒绝，不生成建议", async () => {
		const contact = await contactFixture({ businessRole: "买家" });

		const result = await recordFact({
			contactId: contact.id,
			field: "业务角色",
			value: "买家",
			evidence: [evidence("crm.note", "使用者在对话中说明：「买家是美国客户」")],
			source: "agent",
		});

		expect(result.stored).toBe(false);
		expect(result.reason).toContain("已经是这个值");

		const facts = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(facts).toHaveLength(0);
	});

	test("字段名对不上时，拒绝信息里指出库里的相近字段", async () => {
		const contact = await contactFixture();

		const result = await recordFact({
			contactId: contact.id,
			field: "邮箱地址",
			value: "a@example.com",
			evidence: [evidence("crm.note", "邮箱 a@example.com")],
			source: "agent",
		});

		expect(result.stored).toBe(false);
		expect(result.reason).toContain("「邮箱」");
	});

	test("国家字段写入时把英文写法归一成标准中文国名", async () => {
		const contact = await contactFixture();

		const result = await recordFact({
			contactId: contact.id,
			field: "国家",
			value: "United States",
			evidence: [evidence("crm.note", "US customer")],
			source: "agent",
		});

		expect(result.applied).toBe(true);

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.country).toBe("美国");
	});

	test("邮编走固定列写入", async () => {
		const contact = await contactFixture();

		const result = await recordFact({
			contactId: contact.id,
			field: "邮编",
			value: "31170",
			evidence: [evidence("crm.note", "31170 Tournefeuille")],
			source: "agent",
		});

		expect(result.applied).toBe(true);

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.postalCode).toBe("31170");
	});

	test("撤销已写入的值：无独立列的字段值随之从档案消失", async () => {
		const contact = await contactFixture();

		await recordFact({
			contactId: contact.id,
			field: "手机",
			value: "13800000000",
			evidence: [evidence("crm.note", "手机 13800000000")],
			source: "agent",
		});

		const [applied] = await db()
			.select()
			.from(contactFacts)
			.where(eq(contactFacts.contactId, contact.id));
		expect(applied.status).toBe("applied");

		const undone = await revertFact(applied.id);
		expect(undone.ok).toBe(true);

		const [after] = await db().select().from(contactFacts).where(eq(contactFacts.id, applied.id));
		expect(after.status).toBe("superseded");
	});

	test("撤销有独立列的字段值：列里的现值不动", async () => {
		const contact = await contactFixture();

		await recordFact({
			contactId: contact.id,
			field: "业务角色",
			value: "买家",
			evidence: [evidence("crm.note", "对方询问购买样品")],
			source: "agent",
		});

		const [applied] = await db()
			.select()
			.from(contactFacts)
			.where(eq(contactFacts.contactId, contact.id));
		await revertFact(applied.id);

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(row.businessRole).toBe("买家");
	});
});
