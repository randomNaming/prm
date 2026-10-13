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

	test("电话、联系电话、手机、phone、telephone 命中同一个字段，不新建", async () => {
		for (const label of ["电话", "联系电话", "手机", "手机号", "phone", "Telephone", "PHONE"]) {
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
