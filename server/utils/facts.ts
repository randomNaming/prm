import { and, desc, eq, inArray } from "drizzle-orm";
import {
	FACT_FIELD_LABELS,
	FACT_FIELDS,
	type ContactFact,
	type FactField,
} from "../../app/types/domain";
import { contactFacts, contacts } from "../db/schema";
import { db } from "./db";
import { decideFact, sameValue } from "./fact-rules";
import { findFieldDef, findFieldDefAnyScope, closeFieldDefs } from "./fields";
import { normalizeCountry } from "../../app/utils/countries";
import { newId, nowMs } from "./ids";
import { toFact } from "./contacts";
import type { RecordFactInput } from "./validate";

type FactColumn =
	| "title"
	| "email"
	| "phone"
	| "wechatId"
	| "address"
	| "country"
	| "postalCode"
	| "customerGrade"
	| "businessRole"
	| "linkedin"
	| "github";

const FIELD_COLUMNS: Record<string, FactColumn> = {
	title: "title",
	email: "email",
	phone: "phone",
	wechat_id: "wechatId",
	address: "address",
	country: "country",
	postal_code: "postalCode",
	customer_grade: "customerGrade",
	business_role: "businessRole",
	linkedin: "linkedin",
	github: "github",
};

function hasColumn(key: string): boolean {
	return key in FIELD_COLUMNS;
}

export type RecordFactResult = {
	stored: boolean;
	applied: boolean;
	status: string;
	field: string;
	reason: string;
};

export async function recordFact(input: RecordFactInput): Promise<RecordFactResult> {
	let value = input.value.trim();
	const def = await findFieldDef({ scope: "contact", term: input.field });
	// 国家存标准中文国名：agent 抄原文时可能写成 US / United States，能认出来的都归一，
	// 认不出的原样保留——宁可有生僻写法，也不错删信息。
	if (def?.key === "country") value = normalizeCountry(value) ?? value;
	const refused = (reason: string): RecordFactResult => ({
		stored: false,
		applied: false,
		status: "rejected",
		field: input.field,
		reason,
	});

	if (!def || def.status !== "active") {
		const other = await findFieldDefAnyScope(input.field);

		if (other && other.status === "active") {
			return refused(
				`「${input.field}」是${other.scope === "company" ? "公司" : "联系人"}字段（${other.key}），请用 ${other.scope === "company" ? "record_company_fact" : "record_fact"} 写到对应记录上。`,
			);
		}

		// 叫法对不上但库里其实有相近字段时，把正确的名字告诉智能体，让它当场改写重试，
		// 而不是任由它去 propose_field 又建一个同义字段。
		if (!other) {
			const close = await closeFieldDefs("contact", input.field);

			if (close.length > 0) {
				const names = close.map((item) => `「${item.label}」`).join("、");
				return refused(
					`字段「${input.field}」不在联系人字段表里，但库里已有相近字段 ${names}。请改用其中正确的字段名重新调用；确实都不对，再用 propose_field 提新字段。`,
				);
			}
		}

		return refused(
			`字段「${input.field}」不在联系人字段表里。先调用 propose_field 提出这个字段，等人确认后再写。`,
		);
	}

	if (!def.agentWritable) {
		return refused(`「${def.label}」由人工填写，智能体不写。`);
	}

	const label = def.label;
	const column = hasColumn(def.key) ? FIELD_COLUMNS[def.key] : null;

	return db().transaction(async (tx) => {
		const [contact] = await tx
			.select()
			.from(contacts)
			.where(eq(contacts.id, input.contactId))
			.limit(1)
			.for("update");

		if (!contact) return refused("联系不存在。");

		const existing = await tx
			.select()
			.from(contactFacts)
			.where(and(eq(contactFacts.contactId, input.contactId), eq(contactFacts.field, def.key)));

		const appliedFact = existing.find((fact) => fact.status === "applied");
		const columnValue = column ? contact[column] : null;
		const agentOwnsColumn = Boolean(
			appliedFact && columnValue && sameValue(appliedFact.value, columnValue),
		);
		const currentValue = column ? columnValue : (appliedFact?.value ?? null);
		const currentIsHuman = column
			? Boolean(columnValue) && !agentOwnsColumn
			: appliedFact?.source === "human";

		const outcome = decideFact({
			label,
			value,
			evidence: input.evidence,
			existing,
			currentValue,
			currentIsHuman,
		});

		if (outcome.kind === "refused") return refused(outcome.reason);

		const at = nowMs();

		if (outcome.kind === "applied") {
			await tx
				.update(contactFacts)
				.set({ status: "superseded", decidedAt: at })
				.where(
					and(
						eq(contactFacts.contactId, input.contactId),
						eq(contactFacts.field, def.key),
						inArray(contactFacts.status, ["applied", "proposed"]),
					),
				);
		}

		await tx.insert(contactFacts).values({
			id: newId(),
			contactId: input.contactId,
			field: def.key,
			value,
			status: outcome.kind,
			evidence: input.evidence,
			source: input.source,
			createdAt: at,
		});

		if (outcome.kind === "applied") {
			if (column) {
				await tx
					.update(contacts)
					.set({ [column]: value, updatedAt: at, lastResearchedAt: at })
					.where(eq(contacts.id, input.contactId));
			} else {
				await tx
					.update(contacts)
					.set({ updatedAt: at, lastResearchedAt: at })
					.where(eq(contacts.id, input.contactId));
			}
		}

		return {
			stored: true,
			applied: outcome.kind === "applied",
			status: outcome.kind,
			field: def.key,
			reason: outcome.reason,
		};
	});
}

export async function proposedFacts(contactId: string): Promise<ContactFact[]> {
	const rows = await db()
		.select()
		.from(contactFacts)
		.where(and(eq(contactFacts.contactId, contactId), eq(contactFacts.status, "proposed")))
		.orderBy(desc(contactFacts.createdAt));

	return rows.map(toFact);
}

export async function factsFor(contactId: string): Promise<ContactFact[]> {
	const rows = await db()
		.select()
		.from(contactFacts)
		.where(eq(contactFacts.contactId, contactId))
		.orderBy(desc(contactFacts.createdAt));

	return rows.map(toFact);
}

export async function acceptFact(factId: string): Promise<{ ok: boolean; reason: string }> {
	return db().transaction(async (tx) => {
		const [fact] = await tx
			.select()
			.from(contactFacts)
			.where(eq(contactFacts.id, factId))
			.limit(1);

		if (!fact) return { ok: false, reason: "建议不存在。" };
		if (fact.status !== "proposed") return { ok: false, reason: "这条建议已经处理过了。" };

		const [contact] = await tx
			.select({ id: contacts.id })
			.from(contacts)
			.where(eq(contacts.id, fact.contactId))
			.limit(1)
			.for("update");

		if (!contact) return { ok: false, reason: "联系人不存在。" };

		const at = nowMs();

		await tx
			.update(contactFacts)
			.set({ status: "superseded", decidedAt: at })
			.where(
				and(
					eq(contactFacts.contactId, fact.contactId),
					eq(contactFacts.field, fact.field),
					inArray(contactFacts.status, ["applied", "proposed"]),
				),
			);

		await tx
			.update(contactFacts)
			.set({ status: "applied", source: "human", decidedAt: at })
			.where(eq(contactFacts.id, factId));

		if (hasColumn(fact.field)) {
			await tx
				.update(contacts)
				.set({ [FIELD_COLUMNS[fact.field]]: fact.value, updatedAt: at })
				.where(eq(contacts.id, fact.contactId));
		}
		return { ok: true, reason: "已写入联系人字段。" };
	});
}

export async function dismissFact(factId: string): Promise<{ ok: boolean; reason: string }> {
	const [fact] = await db()
		.select()
		.from(contactFacts)
		.where(eq(contactFacts.id, factId))
		.limit(1);

	if (!fact) return { ok: false, reason: "建议不存在。" };
	if (fact.status !== "proposed") return { ok: false, reason: "这条建议已经处理过了。" };

	await db()
		.update(contactFacts)
		.set({ status: "dismissed", decidedAt: nowMs() })
		.where(eq(contactFacts.id, factId));

	return { ok: true, reason: "已拒绝，同一个值不会再出现。" };
}

/**
 * 撤销一条已写入的字段值：把它退回「已被替换」。
 *
 * 刻意不去猜「接受之前的旧值」是什么：接受那一刻没有记录列里原来的内容，
 * 同批被顶掉的行里也分不清哪条是旧值、哪条只是同时关闭的建议，恢复错了比不恢复更糟。
 * 所以只做两件确定安全的事：
 *   - 有独立列的字段（如业务角色）：列里的现值不动，值要改就用「编辑」；
 *   - 只存在事实表里的字段（如手机）：事实退场后值自然从档案消失。
 */
export async function revertFact(factId: string): Promise<{ ok: boolean; reason: string }> {
	return db().transaction(async (tx) => {
		const [fact] = await tx
			.select()
			.from(contactFacts)
			.where(eq(contactFacts.id, factId))
			.limit(1);

		if (!fact) return { ok: false, reason: "建议不存在。" };
		if (fact.status !== "applied") return { ok: false, reason: "只有已写入的值才能撤销。" };

		const [contact] = await tx
			.select({ id: contacts.id })
			.from(contacts)
			.where(eq(contacts.id, fact.contactId))
			.limit(1)
			.for("update");

		if (!contact) return { ok: false, reason: "联系不存在。" };

		const at = nowMs();

		await tx
			.update(contactFacts)
			.set({ status: "superseded", decidedAt: at })
			.where(eq(contactFacts.id, factId));

		await tx.update(contacts).set({ updatedAt: at }).where(eq(contacts.id, fact.contactId));

		return {
			ok: true,
			reason: hasColumn(fact.field)
				? "已撤销该条记录；字段现值未动，要改值请用「编辑」。"
				: "已撤销，值已从档案移除。",
		};
	});
}
