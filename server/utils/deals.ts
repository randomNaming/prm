import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import {
	dealStatusOfStage,
	type Deal,
	type DealDetail,
	type DealStage,
	type DealStatus,
	type Page,
} from "../../app/types/domain";
import { activities, companies, contacts, deals } from "../db/schema";
import { toActivity, toCompany, toContact, toDeal } from "./contacts";
import { db } from "./db";
import { newId, nowMs } from "./ids";
import { containsText } from "./sql";
import type { DealInput, ListQuery } from "./validate";

export type DealQuery = ListQuery & {
	stage?: DealStage;
	status?: DealStatus;
};

export async function listDeals(query: DealQuery): Promise<Page<Deal>> {
	const filters = [
		query.archived ? sql`${deals.archivedAt} IS NOT NULL` : isNull(deals.archivedAt),
	];

	if (query.q) filters.push(containsText(deals.name, query.q));
	if (query.stage) filters.push(eq(deals.stage, query.stage));
	if (query.status) filters.push(eq(deals.status, query.status));

	const where = and(...filters);

	const [rows, totals] = await Promise.all([
		db()
			.select()
			.from(deals)
			.where(where)
			.orderBy(desc(deals.updatedAt))
			.limit(query.pageSize)
			.offset((query.page - 1) * query.pageSize),
		db().select({ total: count() }).from(deals).where(where),
	]);

	return {
		items: rows.map(toDeal),
		total: Number(totals[0]?.total ?? 0),
		page: query.page,
		pageSize: query.pageSize,
	};
}

export async function getDeal(id: string): Promise<Deal | null> {
	const [row] = await db().select().from(deals).where(eq(deals.id, id)).limit(1);

	return row ? toDeal(row) : null;
}

export async function createDeal(input: DealInput): Promise<Deal> {
	const at = nowMs();
	const id = newId();

	await db().insert(deals).values({
		id,
		name: input.name,
		companyId: input.companyId,
		contactId: input.contactId,
		stage: input.stage,
		expectedCloseDate: input.expectedCloseDate,
		status: dealStatusOfStage(input.stage),
		stageChangedAt: at,
		createdAt: at,
		updatedAt: at,
	});

	const created = await getDeal(id);
	if (!created) throw new Error("商机创建失败。");

	return created;
}

export async function updateDeal(id: string, input: DealInput): Promise<Deal | null> {
	const existing = await getDeal(id);
	if (!existing) return null;

	const at = nowMs();
	const stageChanged = existing.stage !== input.stage;

	await db()
		.update(deals)
		.set({
			name: input.name,
			companyId: input.companyId,
			contactId: input.contactId,
			stage: input.stage,
			status: dealStatusOfStage(input.stage),
			expectedCloseDate: input.expectedCloseDate,
			stageChangedAt: stageChanged ? at : existing.stageChangedAt,
			updatedAt: at,
		})
		.where(eq(deals.id, id));

	if (stageChanged) {
		await db().insert(activities).values({
			id: newId(),
			kind: "stage_change",
			dealId: id,
			companyId: input.companyId,
			contactId: input.contactId,
			title: `阶段：${existing.stage} → ${input.stage}`,
			createdAt: at,
		});
	}

	return getDeal(id);
}

export async function changeDealStage(id: string, stage: DealStage): Promise<Deal | null> {
	const existing = await getDeal(id);
	if (!existing || existing.stage === stage) return existing;

	const at = nowMs();

	await db()
		.update(deals)
		.set({
			stage,
			status: dealStatusOfStage(stage),
			stageChangedAt: at,
			updatedAt: at,
		})
		.where(eq(deals.id, id));

	await db().insert(activities).values({
		id: newId(),
		kind: "stage_change",
		dealId: id,
		companyId: existing.companyId,
		contactId: existing.contactId,
		title: `阶段：${existing.stage} → ${stage}`,
		createdAt: at,
	});

	return getDeal(id);
}

export async function archiveDeal(id: string): Promise<boolean> {
	const result = await db()
		.update(deals)
		.set({ archivedAt: nowMs(), updatedAt: nowMs() })
		.where(and(eq(deals.id, id), isNull(deals.archivedAt)));

	return result[0].affectedRows > 0;
}

export async function dealDetail(id: string): Promise<DealDetail | null> {
	const deal = await getDeal(id);
	if (!deal) return null;

	const [companyRow, contactRow, activityRows] = await Promise.all([
		deal.companyId
			? db().select().from(companies).where(eq(companies.id, deal.companyId)).limit(1)
			: Promise.resolve([]),
		deal.contactId
			? db().select().from(contacts).where(eq(contacts.id, deal.contactId)).limit(1)
			: Promise.resolve([]),
		db()
			.select()
			.from(activities)
			.where(eq(activities.dealId, id))
			.orderBy(desc(activities.createdAt))
			.limit(50),
	]);

	return {
		deal,
		company: companyRow[0] ? toCompany(companyRow[0]) : null,
		contact: contactRow[0] ? toContact(contactRow[0]) : null,
		activities: activityRows.map(toActivity),
	};
}

export async function openDeals(limit: number): Promise<Deal[]> {
	const rows = await db()
		.select()
		.from(deals)
		.where(and(isNull(deals.archivedAt), eq(deals.status, "open")))
		.orderBy(deals.stageChangedAt)
		.limit(limit);

	return rows.map(toDeal);
}
