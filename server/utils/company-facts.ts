import { and, desc, eq, inArray } from "drizzle-orm";
import {
	COMPANY_FACT_FIELD_LABELS,
	COMPANY_FACT_FIELDS,
	type CompanyFact,
	type CompanyFactField,
} from "../../app/types/domain";
import { companies, companyFacts } from "../db/schema";
import { db } from "./db";
import { decideFact, sameValue } from "./fact-rules";
import { findFieldDef, findFieldDefAnyScope } from "./fields";
import { newId, nowMs } from "./ids";
import { companyFactField, factStatus, parseEvidence } from "./parse";import type { RecordCompanyFactInput } from "./validate";

type CompanyColumn = "industry" | "description" | "address" | "cooperationRole" | "domain";

const FIELD_COLUMNS: Record<string, CompanyColumn> = {
	industry: "industry",
	description: "description",
	address: "address",
	cooperation_role: "cooperationRole",
	domain: "domain",
};

type CompanyFactRow = typeof companyFacts.$inferSelect;

function toCompanyFact(row: CompanyFactRow): CompanyFact {
	return {
		...row,
		status: factStatus(row.status),
		evidence: parseEvidence(row.evidence),
	};
}

function hasColumn(key: string): boolean {
	return key in FIELD_COLUMNS;
}

export type RecordCompanyFactResult = {
	stored: boolean;
	applied: boolean;
	status: string;
	field: string;
	reason: string;
};

export async function recordCompanyFact(
	input: RecordCompanyFactInput,
): Promise<RecordCompanyFactResult> {
	const value = input.value.trim();
	const def = await findFieldDef({ scope: "company", term: input.field });
	const refused = (reason: string): RecordCompanyFactResult => ({
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
			`字段「${input.field}」不在公司字段表里。先调用 propose_field 提出这个字段，等人确认后再写。`,
		);
	}

	if (!def.agentWritable) {
		return refused(`「${def.label}」由人工填写，智能体不写。`);
	}

	const label = def.label;
	const column = hasColumn(def.key) ? FIELD_COLUMNS[def.key] : null;

	return db().transaction(async (tx) => {
		const [company] = await tx
			.select()
			.from(companies)
			.where(eq(companies.id, input.companyId))
			.limit(1)
			.for("update");

		if (!company) return refused("公司不存在。");

		const existing = await tx
			.select()
			.from(companyFacts)
			.where(
				and(
					eq(companyFacts.companyId, input.companyId),
					eq(companyFacts.field, def.key),
				),
			);

		const appliedFact = existing.find((fact) => fact.status === "applied");
		const columnValue = column ? company[column] : null;
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
				.update(companyFacts)
				.set({ status: "superseded", decidedAt: at })
				.where(
					and(
						eq(companyFacts.companyId, input.companyId),
						eq(companyFacts.field, def.key),
						inArray(companyFacts.status, ["applied", "proposed"]),
					),
				);
		}

		await tx.insert(companyFacts).values({
			id: newId(),
			companyId: input.companyId,
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
					.update(companies)
					.set({ [column]: value, updatedAt: at })
					.where(eq(companies.id, input.companyId));
			} else {
				await tx
					.update(companies)
					.set({ updatedAt: at })
					.where(eq(companies.id, input.companyId));
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

export async function companyFactsFor(companyId: string): Promise<CompanyFact[]> {
	const rows = await db()
		.select()
		.from(companyFacts)
		.where(eq(companyFacts.companyId, companyId))
		.orderBy(desc(companyFacts.createdAt));

	return rows.map(toCompanyFact);
}

export async function acceptCompanyFact(
	factId: string,
): Promise<{ ok: boolean; reason: string }> {
	return db().transaction(async (tx) => {
		const [fact] = await tx
			.select()
			.from(companyFacts)
			.where(eq(companyFacts.id, factId))
			.limit(1);

		if (!fact) return { ok: false, reason: "建议不存在。" };
		if (fact.status !== "proposed") return { ok: false, reason: "这条建议已经处理过了。" };

		const [company] = await tx
			.select({ id: companies.id })
			.from(companies)
			.where(eq(companies.id, fact.companyId))
			.limit(1)
			.for("update");

		if (!company) return { ok: false, reason: "公司不存在。" };

		const at = nowMs();

		await tx
			.update(companyFacts)
			.set({ status: "superseded", decidedAt: at })
			.where(
				and(
					eq(companyFacts.companyId, fact.companyId),
					eq(companyFacts.field, fact.field),
					inArray(companyFacts.status, ["applied", "proposed"]),
				),
			);

		await tx
			.update(companyFacts)
			.set({ status: "applied", source: "human", decidedAt: at })
			.where(eq(companyFacts.id, factId));

		if (hasColumn(fact.field)) {
			await tx
				.update(companies)
				.set({ [FIELD_COLUMNS[fact.field]]: fact.value, updatedAt: at })
				.where(eq(companies.id, fact.companyId));
		}

		return { ok: true, reason: "已写入公司字段。" };
	});
}

export async function dismissCompanyFact(
	factId: string,
): Promise<{ ok: boolean; reason: string }> {
	const [fact] = await db()
		.select()
		.from(companyFacts)
		.where(eq(companyFacts.id, factId))
		.limit(1);

	if (!fact) return { ok: false, reason: "建议不存在。" };
	if (fact.status !== "proposed") return { ok: false, reason: "这条建议已经处理过了。" };

	await db()
		.update(companyFacts)
		.set({ status: "dismissed", decidedAt: nowMs() })
		.where(eq(companyFacts.id, factId));

	return { ok: true, reason: "已拒绝，同一个值不会再出现。" };
}
