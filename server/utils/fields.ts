import { and, asc, eq } from "drizzle-orm";
import type { Evidence, FieldDef, FieldScope, FieldStatus } from "../../app/types/domain";
import { fieldDefs } from "../db/schema";
import { db } from "./db";
import { BUILTIN_FIELD_SEEDS } from "./field-seeds";
import { newId, nowMs } from "./ids";
import { fieldOrigin, fieldScope, fieldStatus, parseAliases, parseEvidence, parseOptions } from "./parse";

type FieldDefRow = typeof fieldDefs.$inferSelect;

const CUSTOM_KEY_LIMIT = 24;
const PUNCTUATION = /[\s\-_/\\.,，。、:：;；()（）[\]【】"'“”·|]+/g;

export function normalizeLabel(value: string): string {
	return value.normalize("NFKC").toLowerCase().replace(PUNCTUATION, "");
}

function toFieldDef(row: FieldDefRow): FieldDef {
	return {
		...row,
		scope: fieldScope(row.scope),
		status: fieldStatus(row.status),
		origin: fieldOrigin(row.origin),
		aliases: parseAliases(row.aliases),
		options: parseOptions(row.options),
		agentWritable: row.agentWritable === 1,
		evidence: row.evidence === null ? null : parseEvidence(row.evidence),
	};
}

export async function addFieldOption(input: {
	scope: FieldScope;
	key: string;
	value: string;
}): Promise<string[]> {
	const def = await findFieldDef({ scope: input.scope, term: input.key });
	if (!def) return [];

	const value = input.value.trim();
	if (!value || def.options.includes(value)) return def.options;

	const options = [...def.options, value];

	await db()
		.update(fieldDefs)
		.set({ options, updatedAt: nowMs() })
		.where(eq(fieldDefs.id, def.id));

	return options;
}

export async function seedBuiltinFields(): Promise<number> {
	let seeded = 0;

	for (const seed of BUILTIN_FIELD_SEEDS) {
		const existing = await getFieldDef(seed.id);

		if (existing) {
			await db()
				.update(fieldDefs)
				.set({
					label: seed.label,
					aliases: seed.aliases,
					options: existing.options.length > seed.options.length ? existing.options : seed.options,
					dataType: seed.dataType,
					agentWritable: seed.agentWritable ? 1 : 0,
					updatedAt: nowMs(),
				})
				.where(eq(fieldDefs.id, seed.id));

			seeded += 1;

			continue;
		}

		await db().insert(fieldDefs).values({
			id: seed.id,
			scope: seed.scope,
			key: seed.key,
			label: seed.label,
			aliases: seed.aliases,
			options: seed.options,
			dataType: seed.dataType,
			origin: "builtin",
			status: "active",
			agentWritable: seed.agentWritable ? 1 : 0,
			createdAt: nowMs(),
			updatedAt: nowMs(),
		});

		seeded += 1;
	}

	return seeded;
}

export async function listFieldDefs(input: {
	scope?: FieldScope;
	status?: FieldStatus;
}): Promise<FieldDef[]> {
	const filters = [];

	if (input.scope) filters.push(eq(fieldDefs.scope, input.scope));
	if (input.status) filters.push(eq(fieldDefs.status, input.status));

	const rows = await db()
		.select()
		.from(fieldDefs)
		.where(filters.length ? and(...filters) : undefined)
		.orderBy(asc(fieldDefs.scope), asc(fieldDefs.createdAt));

	return rows.map(toFieldDef);
}

export async function getFieldDef(id: string): Promise<FieldDef | null> {
	const [row] = await db().select().from(fieldDefs).where(eq(fieldDefs.id, id)).limit(1);

	return row ? toFieldDef(row) : null;
}

function matches(def: FieldDef, normalized: string): boolean {
	if (normalizeLabel(def.key) === normalized) return true;
	if (normalizeLabel(def.label) === normalized) return true;

	return def.aliases.some((alias) => normalizeLabel(alias) === normalized);
}

export async function findFieldDef(input: {
	scope: FieldScope;
	term: string;
}): Promise<FieldDef | null> {
	const normalized = normalizeLabel(input.term);
	if (!normalized) return null;

	const defs = await listFieldDefs({ scope: input.scope });

	return defs.find((def) => matches(def, normalized)) ?? null;
}

export async function findFieldDefAnyScope(term: string): Promise<FieldDef | null> {
	const normalized = normalizeLabel(term);
	if (!normalized) return null;

	const defs = await listFieldDefs({});

	return defs.find((def) => matches(def, normalized)) ?? null;
}

export async function activeFieldKeys(scope: FieldScope): Promise<Set<string>> {
	const defs = await listFieldDefs({ scope, status: "active" });

	return new Set(defs.map((def) => def.key));
}

export async function fieldLabelMap(scope: FieldScope): Promise<Record<string, string>> {
	const defs = await listFieldDefs({ scope, status: "active" });
	const labels: Record<string, string> = {};

	for (const def of defs) labels[def.key] = def.label;

	return labels;
}

export type ProposeFieldOutcome =
	| { outcome: "exists"; def: FieldDef; sameScope: boolean }
	| { outcome: "dismissed_before"; def: FieldDef }
	| { outcome: "proposed"; def: FieldDef };

export async function proposeField(input: {
	scope: FieldScope;
	label: string;
	sampleValue: string | null;
	sampleRef: string | null;
	evidence: Evidence[];
}): Promise<ProposeFieldOutcome> {
	const label = input.label.trim();
	const normalized = normalizeLabel(label);
	const existing = await findFieldDefAnyScope(label);

	if (existing && existing.status !== "dismissed") {
		return {
			outcome: "exists",
			def: existing,
			sameScope: existing.scope === input.scope,
		};
	}

	if (existing) return { outcome: "dismissed_before", def: existing };

	if (!normalized || normalized.length > CUSTOM_KEY_LIMIT) {
		throw new Error(`字段名必须是 1 到 ${CUSTOM_KEY_LIMIT} 个字符。`);
	}

	const at = nowMs();
	const id = newId();

	await db().insert(fieldDefs).values({
		id,
		scope: input.scope,
		key: normalized,
		label,
		aliases: [],
		dataType: "text",
		origin: "agent",
		status: "proposed",
		sampleValue: input.sampleValue,
		sampleRef: input.sampleRef,
		evidence: input.evidence,
		createdAt: at,
		updatedAt: at,
	});

	const created = await getFieldDef(id);
	if (!created) throw new Error("字段定义写入失败。");

	return { outcome: "proposed", def: created };
}

export async function acceptFieldDef(
	id: string,
): Promise<{ ok: boolean; reason: string; def: FieldDef | null }> {
	const def = await getFieldDef(id);
	if (!def) return { ok: false, reason: "字段不存在。", def: null };
	if (def.status !== "proposed") {
		return { ok: false, reason: "这个字段已经处理过了。", def };
	}

	await db()
		.update(fieldDefs)
		.set({ status: "active", decidedAt: nowMs(), updatedAt: nowMs() })
		.where(eq(fieldDefs.id, id));

	return { ok: true, reason: "字段已生效。", def: await getFieldDef(id) };
}

export async function dismissFieldDef(id: string): Promise<{ ok: boolean; reason: string }> {
	const def = await getFieldDef(id);
	if (!def) return { ok: false, reason: "字段不存在。" };
	if (def.status !== "proposed") return { ok: false, reason: "这个字段已经处理过了。" };

	await db()
		.update(fieldDefs)
		.set({ status: "dismissed", decidedAt: nowMs(), updatedAt: nowMs() })
		.where(eq(fieldDefs.id, id));

	return { ok: true, reason: "已拒绝，同一个字段名不会再提。" };
}
