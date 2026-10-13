import { and, desc, eq, inArray } from "drizzle-orm";
import { companyFacts, contactFacts } from "../db/schema";
import { db } from "./db";

/**
 * 列表页用的「字段当前值」快照。
 *
 * 只取 applied 的事实（待确认与已拒绝的不进列表），同一字段有多条时取最新的一条，
 * 与详情页「基本信息」的展示口径保持一致。
 */
export async function appliedFactMap(
	scope: "contact" | "company",
	ids: string[],
): Promise<Map<string, Record<string, string>>> {
	const result = new Map<string, Record<string, string>>();

	if (ids.length === 0) return result;

	const rows =
		scope === "contact"
			? await db()
					.select({
						owner: contactFacts.contactId,
						field: contactFacts.field,
						value: contactFacts.value,
					})
					.from(contactFacts)
					.where(and(inArray(contactFacts.contactId, ids), eq(contactFacts.status, "applied")))
					.orderBy(desc(contactFacts.createdAt))
			: await db()
					.select({
						owner: companyFacts.companyId,
						field: companyFacts.field,
						value: companyFacts.value,
					})
					.from(companyFacts)
					.where(and(inArray(companyFacts.companyId, ids), eq(companyFacts.status, "applied")))
					.orderBy(desc(companyFacts.createdAt));

	for (const row of rows) {
		const bucket = result.get(row.owner) ?? {};

		// 已按 createdAt 倒序，先落进桶里的就是最新值。
		if (bucket[row.field] === undefined) bucket[row.field] = row.value;

		result.set(row.owner, bucket);
	}

	return result;
}
