import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
	Company,
	CompanyDetail,
	CompanyListItem,
	Contact,
	Deal,
	Page,
} from "../../app/types/domain";
import { activities, agentTasks, companies, contacts, deals } from "../db/schema";
import {
	toActivity,
	toCompany,
	toContact,
	toDeal,
	rememberRoleOption,
} from "./contacts";
import { companyFactsFor } from "./company-facts";
import { db } from "./db";
import { newId, nowMs } from "./ids";
import { appliedFactMap } from "./list-facts";
import { concatContains, containsText } from "./sql";
import type { CompanyInput, ListQuery } from "./validate";

/**
 * 每家公司在跑的联系人数，供列表展示。
 *
 * 刻意用「另发一条分组查询」而不是相关子查询：drizzle 只会给出现在本条查询里的表加限定名，
 * 写成子查询时 `contacts.company_id = companies.id` 会被渲染成不带表名的 `company_id = id`，
 * 变成 contacts 表内部自比，永远数出 0。
 */
async function liveContactCounts(ids: string[]): Promise<Map<string, number>> {
	const counts = new Map<string, number>();

	if (ids.length === 0) return counts;

	const rows = await db()
		.select({ companyId: contacts.companyId, total: count() })
		.from(contacts)
		.where(and(inArray(contacts.companyId, ids), isNull(contacts.archivedAt)))
		.groupBy(contacts.companyId);

	for (const row of rows) {
		if (row.companyId) counts.set(row.companyId, Number(row.total));
	}

	return counts;
}

export async function listCompanies(query: ListQuery): Promise<Page<CompanyListItem>> {
	const filters = [
		query.archived ? sql`${companies.archivedAt} IS NOT NULL` : isNull(companies.archivedAt),
	];

	if (query.q) {
		filters.push(
			sql`(${containsText(companies.name, query.q)} OR ${containsText(companies.domain, query.q)})`,
		);
	}

	const where = and(...filters);

	const [rows, totals] = await Promise.all([
		db()
			.select()
			.from(companies)
			.where(where)
			.orderBy(desc(companies.updatedAt))
			.limit(query.pageSize)
			.offset((query.page - 1) * query.pageSize),
		db().select({ total: count() }).from(companies).where(where),
	]);

	const ids = rows.map((row) => row.id);

	const [contactCounts, facts] = await Promise.all([
		liveContactCounts(ids),
		appliedFactMap("company", ids),
	]);

	return {
		items: rows.map((row) => ({
			...toCompany(row),
			contactCount: contactCounts.get(row.id) ?? 0,
			facts: facts.get(row.id) ?? {},
		})),
		total: Number(totals[0]?.total ?? 0),
		page: query.page,
		pageSize: query.pageSize,
	};
}

export async function getCompany(id: string): Promise<Company | null> {
	const [row] = await db().select().from(companies).where(eq(companies.id, id)).limit(1);

	return row ? toCompany(row) : null;
}

export async function createCompany(input: CompanyInput): Promise<Company> {
	const at = nowMs();
	const id = newId();

	await db().insert(companies).values({
		id,
		name: input.name,
		domain: input.domain,
		industry: input.industry,
		address: input.address,
		cooperationRole: input.cooperationRole,
		description: input.description,
		source: "manual",
		createdAt: at,
		updatedAt: at,
	});

	await rememberRoleOption("company", "cooperation_role", input.cooperationRole);

	const created = await getCompany(id);
	if (!created) throw new Error("公司创建失败。");

	return created;
}

export async function updateCompany(id: string, input: CompanyInput): Promise<Company | null> {
	const existing = await getCompany(id);
	if (!existing) return null;

	await db()
		.update(companies)
		.set({
			name: input.name,
			domain: input.domain,
			industry: input.industry,
			address: input.address,
			cooperationRole: input.cooperationRole,
			description: input.description,
			updatedAt: nowMs(),
		})
		.where(eq(companies.id, id));

	await rememberRoleOption("company", "cooperation_role", input.cooperationRole);

	return getCompany(id);
}

export async function archiveCompany(id: string): Promise<boolean> {
	const result = await db()
		.update(companies)
		.set({ archivedAt: nowMs(), updatedAt: nowMs() })
		.where(and(eq(companies.id, id), isNull(companies.archivedAt)));

	return result[0].affectedRows > 0;
}

export async function restoreCompany(id: string): Promise<boolean> {
	const existing = await getCompany(id);
	if (!existing) return false;

	// 不靠 affectedRows 判断：把已经是 NULL 的 archived_at 再写成 NULL，
	// MySQL 算作「没有变化」返回 0，会被误判成记录不存在。
	await db()
		.update(companies)
		.set({ archivedAt: null, updatedAt: nowMs() })
		.where(eq(companies.id, id));

	return true;
}

export async function companyContacts(companyId: string): Promise<Contact[]> {
	const rows = await db()
		.select()
		.from(contacts)
		.where(and(eq(contacts.companyId, companyId), isNull(contacts.archivedAt)))
		.orderBy(desc(contacts.updatedAt));

	return rows.map(toContact);
}

export async function companyDeals(companyId: string): Promise<Deal[]> {
	const rows = await db()
		.select()
		.from(deals)
		.where(and(eq(deals.companyId, companyId), isNull(deals.archivedAt)))
		.orderBy(desc(deals.updatedAt));

	return rows.map(toDeal);
}

export async function companyIsResearching(companyId: string): Promise<boolean> {
	const [row] = await db()
		.select({ id: agentTasks.id })
		.from(agentTasks)
		.where(
			and(
				eq(agentTasks.targetId, companyId),
				// 只算真正在推进的：未来的复查预约是排期，不该让详情页显示「正在研究」。
				sql`${agentTasks.status} IN ('pending', 'running')`,
				sql`(${agentTasks.status} = 'running' OR ${agentTasks.runAt} IS NULL OR ${agentTasks.runAt} <= ${nowMs()})`,
			),
		)
		.limit(1);

	return Boolean(row);
}

export async function companyDetail(id: string): Promise<CompanyDetail | null> {
	const company = await getCompany(id);
	if (!company) return null;

	const [people, dealRows, activityRows, facts, researching] = await Promise.all([
		companyContacts(id),
		companyDeals(id),
		db()
			.select()
			.from(activities)
			.where(eq(activities.companyId, id))
			.orderBy(desc(activities.createdAt))
			.limit(50),
		companyFactsFor(id),
		companyIsResearching(id),
	]);

	return {
		company,
		contacts: people,
		deals: dealRows,
		activities: activityRows.map(toActivity),
		facts,
		researching,
	};
}

export async function findCompanyByName(name: string): Promise<Company | null> {
	const [row] = await db()
		.select()
		.from(companies)
		.where(eq(companies.name, name))
		.limit(1);

	return row ? toCompany(row) : null;
}

export async function ensureCompany(name: string): Promise<{ id: string; created: boolean }> {
	const existing = await findCompanyByName(name);
	if (existing) return { id: existing.id, created: false };

	const at = nowMs();
	const id = newId();

	await db().insert(companies).values({
		id,
		name,
		source: "agent",
		createdAt: at,
		updatedAt: at,
	});

	return { id, created: true };
}

export async function companyOptions(term: string): Promise<Company[]> {
	const rows = await db()
		.select()
		.from(companies)
		.where(
			and(
				isNull(companies.archivedAt),
				term ? concatContains([companies.name], term) : undefined,
			),
		)
		.orderBy(companies.name)
		.limit(50);

	return rows.map(toCompany);
}
