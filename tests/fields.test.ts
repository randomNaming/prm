import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { contactFacts, contacts } from "../server/db/schema";
import { closeDb, db } from "../server/utils/db";
import {
	acceptFieldDef,
	dismissFieldDef,
	findFieldDef,
	listFieldDefs,
	normalizeLabel,
	proposeField,
} from "../server/utils/fields";
import { recordFact } from "../server/utils/facts";
import { contactFixture, evidence, resetDatabase } from "./helpers";

beforeEach(async () => {
	await resetDatabase();
});

afterAll(async () => {
	await closeDb();
});

describe("字段登记表：归一化与同义词去重", () => {
	test("内置字段带中英别名，一次种子写全", async () => {
		const defs = await listFieldDefs({ scope: "contact" });
		const phone = defs.find((def) => def.key === "phone");

		expect(phone?.label).toBe("电话");
		expect(phone?.aliases).toContain("联系电话");
		expect(phone?.aliases).toContain("telephone");
		expect(phone?.status).toBe("active");
		expect(phone?.origin).toBe("builtin");
	});

	test("归一化忽略大小写、空白、标点与全角", () => {
		expect(normalizeLabel(" 联系电话 ")).toBe("联系电话");
		expect(normalizeLabel("E-Mail")).toBe("email");
		expect(normalizeLabel("ｅ－ｍａｉｌ")).toBe("email");
		expect(normalizeLabel("phone_number")).toBe("phonenumber");
	});

	test("电话、联系电话、phone、telephone 命中同一个字段，不新建", async () => {
		for (const label of ["电话", "联系电话", "phone", "Telephone", "PHONE"]) {
			const found = await findFieldDef({ scope: "contact", term: label });

			expect(found?.key).toBe("phone");
		}

		const proposed = await proposeField({
			scope: "contact",
			label: "联系电话",
			sampleValue: "18929345383",
			sampleRef: null,
			evidence: [evidence()],
		});

		expect(proposed.outcome).toBe("exists");
		expect(proposed.outcome === "exists" ? proposed.def.key : "").toBe("phone");

		const defs = await listFieldDefs({ scope: "contact" });
		expect(defs.filter((def) => def.label === "联系电话")).toHaveLength(0);
	});

	test("「手机」已从「电话」的别名里摘掉，提议「手机」命中独立的手机字段", async () => {
		// 手机曾经是电话的别名，导致 Cell / Home 两个号只能拼进同一条值。
		// 这条守住拆分结果：再被合并回去就会红。
		const proposed = await proposeField({
			scope: "contact",
			label: "手机",
			sampleValue: "708-557-7187",
			sampleRef: null,
			evidence: [evidence()],
		});

		expect(proposed.outcome).toBe("exists");
		expect(proposed.outcome === "exists" ? proposed.def.key : "").toBe("phone_mobile");

		const defs = await listFieldDefs({ scope: "contact" });
		expect(defs.filter((def) => def.label === "手机")).toHaveLength(1);

		const phone = defs.find((def) => def.key === "phone");
		expect(phone?.aliases).not.toContain("手机");
		expect(phone?.aliases).not.toContain("手机号");
		expect(phone?.aliases).not.toContain("mobile");
		expect(phone?.aliases).not.toContain("cell");
	});

	test("跨作用域：联系人资料里的行业命中公司字段，并指明该写哪边", async () => {
		const proposed = await proposeField({
			scope: "contact",
			label: "行业",
			sampleValue: "智能健康手表",
			sampleRef: null,
			evidence: [evidence()],
		});

		expect(proposed.outcome).toBe("exists");

		if (proposed.outcome === "exists") {
			expect(proposed.sameScope).toBe(false);
			expect(proposed.def.scope).toBe("company");
			expect(proposed.def.key).toBe("industry");
		}
	});
});

describe("新字段要人工确认后才生效", () => {
	test("未确认前不能写值；确认后可以写，值只存在事实表里", async () => {
		const contact = await contactFixture();

		const proposed = await proposeField({
			scope: "contact",
			label: "客户等级",
			sampleValue: "A 类",
			sampleRef: contact.id,
			evidence: [evidence("crm.note", "客户等级：A 类", contact.id)],
		});

		expect(proposed.outcome).toBe("proposed");
		const fieldId = proposed.def.id;

		const beforeAccept = await recordFact({
			contactId: contact.id,
			field: "客户等级",
			value: "A 类",
			evidence: [evidence("crm.note", "客户等级：A 类", contact.id)],
			source: "agent",
		});
		expect(beforeAccept.stored).toBe(false);
		expect(beforeAccept.reason).toContain("propose_field");

		const accepted = await acceptFieldDef(fieldId);
		expect(accepted.ok).toBe(true);
		expect(accepted.def?.status).toBe("active");

		const written = await recordFact({
			contactId: contact.id,
			field: "客户等级",
			value: "A 类",
			evidence: [evidence("crm.note", "客户等级：A 类", contact.id)],
			source: "agent",
		});
		expect(written.stored).toBe(true);
		expect(written.applied).toBe(true);

		const facts = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contact.id));
		expect(facts).toHaveLength(1);
		expect(facts[0].field).toBe("客户等级");
		expect(facts[0].value).toBe("A 类");
		expect(facts[0].evidence).toBeTruthy();

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));
		expect(Object.values(row)).not.toContain("A 类");
	});

	test("拒绝过的字段名不再被提议", async () => {
		const first = await proposeField({
			scope: "contact",
			label: "决策角色",
			sampleValue: null,
			sampleRef: null,
			evidence: [evidence()],
		});
		expect(first.outcome).toBe("proposed");

		await dismissFieldDef(first.def.id);

		const again = await proposeField({
			scope: "contact",
			label: "决策角色",
			sampleValue: null,
			sampleRef: null,
			evidence: [evidence()],
		});
		expect(again.outcome).toBe("dismissed_before");

		const defs = await listFieldDefs({ scope: "contact", status: "proposed" });
		expect(defs).toHaveLength(0);
	});

	test("自定义字段也守铁律：人工确认过的值不被智能体覆盖", async () => {
		const contact = await contactFixture();
		const proposed = await proposeField({
			scope: "contact",
			label: "年采购量",
			sampleValue: null,
			sampleRef: null,
			evidence: [evidence()],
		});
		await acceptFieldDef(proposed.def.id);

		const agentValue = await recordFact({
			contactId: contact.id,
			field: "年采购量",
			value: "5 万台",
			evidence: [evidence("crm.note", "年采购量 5 万台", contact.id)],
			source: "agent",
		});
		expect(agentValue.applied).toBe(true);

		const humanValue = await recordFact({
			contactId: contact.id,
			field: "年采购量",
			value: "8 万台",
			evidence: [evidence("crm.note", "人工确认：8 万台", contact.id)],
			source: "human",
		});
		expect(humanValue.applied).toBe(true);

		const agentAgain = await recordFact({
			contactId: contact.id,
			field: "年采购量",
			value: "12 万台",
			evidence: [evidence("crm.note", "年采购量 12 万台", contact.id)],
			source: "agent",
		});
		expect(agentAgain.applied).toBe(false);
		expect(agentAgain.status).toBe("proposed");
	});
});

describe("电话按类型拆开：手机不再被「电话」吃掉", () => {
	test("「手机」命中独立字段，不再解析成「电话」", async () => {
		const phone = await findFieldDef({ scope: "contact", term: "电话" });
		const mobile = await findFieldDef({ scope: "contact", term: "手机" });

		expect(phone?.key).toBe("phone");
		expect(phone?.label).toBe("电话");
		expect(mobile?.key).toBe("phone_mobile");
		expect(mobile?.label).toBe("手机");
	});

	test("cell / mobile / home / office / 座机 各归各的字段", async () => {
		const cases: [string, string][] = [
			["cell", "phone_mobile"],
			["Cell", "phone_mobile"],
			["mobile", "phone_mobile"],
			["手机号", "phone_mobile"],
			["Home", "phone_home"],
			["住宅电话", "phone_home"],
			["office phone", "phone_work"],
			["座机", "phone_work"],
			["联系电话", "phone"],
		];

		for (const [term, key] of cases) {
			const def = await findFieldDef({ scope: "contact", term });

			expect(`${term} → ${def?.key}`).toBe(`${term} → ${key}`);
		}
	});

	test("两个号码分别落两个字段，谁也不拼进同一条值", async () => {
		const contact = await contactFixture();
		const chat = [evidence("wechat.chat", "Home : 708-756-0361 Cell: 708-557-7187", "David@a.txt")];

		const mobile = await recordFact({
			contactId: contact.id,
			field: "手机",
			value: "708-557-7187",
			evidence: chat,
			source: "agent",
		});
		const home = await recordFact({
			contactId: contact.id,
			field: "家庭电话",
			value: "708-756-0361",
			evidence: chat,
			source: "agent",
		});

		expect(mobile.applied).toBe(true);
		expect(home.applied).toBe(true);

		const facts = await db()
			.select()
			.from(contactFacts)
			.where(eq(contactFacts.contactId, contact.id));
		const byField = Object.fromEntries(facts.map((fact) => [fact.field, fact.value]));

		expect(byField.phone_mobile).toBe("708-557-7187");
		expect(byField.phone_home).toBe("708-756-0361");
		// 关键：两个号没有再被拼进同一条值
		expect(byField.phone).toBeUndefined();
		expect(JSON.stringify(byField)).not.toContain("/");
	});

	test("类型字段没有独立数据库列，值只存在事实表里", async () => {
		const contact = await contactFixture();
		await recordFact({
			contactId: contact.id,
			field: "手机",
			value: "708-557-7187",
			evidence: [evidence()],
			source: "agent",
		});

		const [row] = await db().select().from(contacts).where(eq(contacts.id, contact.id));

		expect(row.phone).toBeNull();
		expect(Object.values(row)).not.toContain("708-557-7187");
	});
});

describe("关系维护由人工填写，智能体不写", () => {
	test("智能体走 record_fact 写「关系维护」会被拒", async () => {
		const contact = await contactFixture();

		const refused = await recordFact({
			contactId: contact.id,
			field: "关系维护",
			value: "关系待修复",
			evidence: [evidence("wechat.chat", "This is not a smart watch", "d@a.txt")],
			source: "agent",
		});

		expect(refused.stored).toBe(false);
		expect(refused.reason).toContain("由人工填写");
	});

	test("「修复说明」同样不开放给智能体", async () => {
		const contact = await contactFixture();

		const refused = await recordFact({
			contactId: contact.id,
			field: "修复说明",
			value: "等新一代计步方案",
			evidence: [evidence()],
			source: "agent",
		});

		expect(refused.stored).toBe(false);
		expect(refused.reason).toContain("由人工填写");
	});

	test("登记表里是内置、生效、不可被智能体写", async () => {
		const defs = await listFieldDefs({ scope: "contact" });
		const state = defs.find((def) => def.key === "relationship_state");

		expect(state?.label).toBe("关系维护");
		expect(state?.origin).toBe("builtin");
		expect(state?.status).toBe("active");
		expect(state?.agentWritable).toBe(false);
		expect(state?.options).toContain("关系待修复");
	});
});
