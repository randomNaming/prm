import { and, desc, isNull, or } from "drizzle-orm";
import type { SearchHit } from "../../app/types/domain";
import { companies, contacts, deals } from "../db/schema";
import { db } from "./db";
import { concatContains, containsText } from "./sql";

export async function searchCrm(term: string, limit: number): Promise<SearchHit[]> {
	const query = term.trim();

	if (!query) return [];

	const [contactRows, companyRows, dealRows] = await Promise.all([
		db()
			.select()
			.from(contacts)
			.where(
				and(
					isNull(contacts.archivedAt),
					or(
						concatContains([contacts.firstName, contacts.lastName], query),
						containsText(contacts.email, query),
						containsText(contacts.wechatId, query),
					),
				),
			)
			.orderBy(desc(contacts.updatedAt))
			.limit(limit),
		db()
			.select()
			.from(companies)
			.where(
				and(
					isNull(companies.archivedAt),
					or(containsText(companies.name, query), containsText(companies.domain, query)),
				),
			)
			.orderBy(desc(companies.updatedAt))
			.limit(limit),
		db()
			.select()
			.from(deals)
			.where(and(isNull(deals.archivedAt), containsText(deals.name, query)))
			.orderBy(desc(deals.updatedAt))
			.limit(limit),
	]);

	const hits: SearchHit[] = [
		...contactRows.map((row) => ({
			type: "contact" as const,
			id: row.id,
			label: `${row.firstName}${row.lastName ?? ""}`,
			detail: [row.title, row.email, row.wechatId].filter(Boolean).join(" · "),
		})),
		...companyRows.map((row) => ({
			type: "company" as const,
			id: row.id,
			label: row.name,
			detail: [row.industry, row.domain].filter(Boolean).join(" · "),
		})),
		...dealRows.map((row) => ({
			type: "deal" as const,
			id: row.id,
			label: row.name,
			detail: row.stage,
		})),
	];

	return hits;
}
