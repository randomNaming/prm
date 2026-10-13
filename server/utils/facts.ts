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
import { findFieldDef, findFieldDefAnyScope } from "./fields";
import { newId, nowMs } from "./ids";
import { toFact } from "./contacts";
import type { RecordFactInput } from "./validate";

type FactColumn =
	| "title"
	| "email"
	| "phone"
	| "wechatId"
	| "address"
	| "businessRole"
	| "linkedin"
	| "github";

const FIELD_COLUMNS: Record<string, FactColumn> = {
	title: "title",
	email: "email",
	phone: "phone",
	wechat_id: "wechatId",
	address: "address",
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
	const value = input.value.trim();
	const def = await findFieldDef({ scope: "contact", term: input.field });
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
