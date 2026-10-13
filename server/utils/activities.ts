import { and, count, desc, eq, isNull, lt } from "drizzle-orm";
import type {
	Activity,
	ActivityKind,
	DashboardActivity,
	DashboardTask,
	Page,
} from "../../app/types/domain";
import { activities, contacts } from "../db/schema";
import { toActivity } from "./contacts";
import { db } from "./db";
import { newId, nowMs } from "./ids";
import type { ActivityInput } from "./validate";

export async function createActivity(input: ActivityInput): Promise<Activity> {
	const id = newId();
	const at = nowMs();

	await db().insert(activities).values({
		id,
		kind: input.kind,
		contactId: input.contactId,
		companyId: input.companyId,
		dealId: input.dealId,
		title: input.title,
		body: input.body,
		dueAt: input.dueAt,
		createdAt: at,
	});

	const [row] = await db().select().from(activities).where(eq(activities.id, id)).limit(1);
	if (!row) throw new Error("活动创建失败。");

	return toActivity(row);
}

export async function listActivities(input: {
	contactId?: string | null;
	companyId?: string | null;
	dealId?: string | null;
	kind?: ActivityKind;
	limit: number;
	page: number;
}): Promise<Page<Activity>> {
	const filters = [];

	if (input.contactId) filters.push(eq(activities.contactId, input.contactId));
	if (input.companyId) filters.push(eq(activities.companyId, input.companyId));
	if (input.dealId) filters.push(eq(activities.dealId, input.dealId));
	if (input.kind) filters.push(eq(activities.kind, input.kind));

	const where = filters.length ? and(...filters) : undefined;

	const [rows, totals] = await Promise.all([
		db()
			.select()
			.from(activities)
			.where(where)
			.orderBy(desc(activities.createdAt))
			.limit(input.limit)
			.offset((input.page - 1) * input.limit),
		db().select({ total: count() }).from(activities).where(where),
	]);

	return {
		items: rows.map(toActivity),
		total: Number(totals[0]?.total ?? 0),
		page: input.page,
		pageSize: input.limit,
	};
}

export async function completeActivity(id: string): Promise<boolean> {
	const result = await db()
		.update(activities)
		.set({ completedAt: nowMs() })
		.where(and(eq(activities.id, id), isNull(activities.completedAt)));

	return result[0].affectedRows > 0;
}

export async function reopenActivity(id: string): Promise<boolean> {
	const result = await db()
		.update(activities)
		.set({ completedAt: null })
		.where(eq(activities.id, id));

	return result[0].affectedRows > 0;
}

export async function overdueTasks(now: number, limit: number): Promise<DashboardTask[]> {
	const rows = await db()
		.select({
			id: activities.id,
			title: activities.title,
			dueAt: activities.dueAt,
			contactId: activities.contactId,
			contactFirst: contacts.firstName,
			contactLast: contacts.lastName,
		})
		.from(activities)
		.leftJoin(contacts, eq(activities.contactId, contacts.id))
		.where(
			and(
				eq(activities.kind, "task"),
				isNull(activities.completedAt),
				lt(activities.dueAt, now),
			),
		)
		.orderBy(activities.dueAt)
		.limit(limit);

	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		dueAt: row.dueAt,
		contactId: row.contactId,
		contactName: row.contactFirst
			? `${row.contactFirst}${row.contactLast ?? ""}`
			: null,
	}));
}

export async function recentActivities(limit: number): Promise<DashboardActivity[]> {
	const rows = await db()
		.select({
			id: activities.id,
			kind: activities.kind,
			title: activities.title,
			body: activities.body,
			createdAt: activities.createdAt,
			contactId: activities.contactId,
			contactFirst: contacts.firstName,
			contactLast: contacts.lastName,
		})
		.from(activities)
		.leftJoin(contacts, eq(activities.contactId, contacts.id))
		.orderBy(desc(activities.createdAt))
		.limit(limit);

	return rows.map((row) => ({
		id: row.id,
		kind: row.kind as ActivityKind,
		title: row.title,
		body: row.body,
		createdAt: row.createdAt,
		contactId: row.contactId,
		contactName: row.contactFirst ? `${row.contactFirst}${row.contactLast ?? ""}` : null,
	}));
}

export async function stageChangeActivity(input: {
	dealId: string;
	title: string;
	companyId: string | null;
	contactId: string | null;
}): Promise<void> {
	await db().insert(activities).values({
		id: newId(),
		kind: "stage_change",
		dealId: input.dealId,
		companyId: input.companyId,
		contactId: input.contactId,
		title: input.title,
		createdAt: nowMs(),
	});
}
