import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type {
	Activity,
	Company,
	Contact,
	ContactDetail,
	ContactFact,
	ContactListItem,
	Deal,
	Page,
} from "../../app/types/domain";
import { RELATIONSHIP_BLANK } from "../../app/types/domain";
import {
	activities,
	companies,
	contactFacts,
	contacts,
	deals,
	agentTasks,
} from "../db/schema";
import { db } from "./db";
import { addFieldOption } from "./fields";
import { latestInsights } from "./insights";
import { intakeArchives } from "./intake-archive";
import { appliedFactMap } from "./list-facts";
import { newId, nowMs } from "./ids";
import { allPromises } from "./promises";
import {
	activityKind,
	dealStage,
	dealStatus,
	factField,
	factStatus,
	parseEvidence,
} from "./parse";
import type { ContactInput, ListQuery } from "./validate";
import { concatContains, containsText } from "./sql";

type ContactRow = typeof contacts.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;
type DealRow = typeof deals.$inferSelect;
type ActivityRow = typeof activities.$inferSelect;
type FactRow = typeof contactFacts.$inferSelect;

export function toContact(row: ContactRow): Contact {
	return { ...row };
}

export async function rememberRoleOption(
	scope: "contact" | "company",
	key: string,
	value: string | null,
): Promise<void> {
	if (!value) return;

	await addFieldOption({ scope, key, value });
}

export function toCompany(row: CompanyRow): Company {
	return { ...row };
}

export function toDeal(row: DealRow): Deal {
	return {
		id: row.id,
		name: row.name,
		companyId: row.companyId,
		contactId: row.contactId,
		stage: dealStage(row.stage),
		expectedCloseDate: row.expectedCloseDate,
		status: dealStatus(row.status),
		stageChangedAt: row.stageChangedAt,
		archivedAt: row.archivedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function toActivity(row: ActivityRow): Activity {
	return { ...row, kind: activityKind(row.kind) };
}

export function toFact(row: FactRow): ContactFact {
	return {
		...row,
		status: factStatus(row.status),
		evidence: parseEvidence(row.evidence),
	};
}

export async function listContacts(query: ListQuery): Promise<Page<ContactListItem>> {
	const filters = [
		query.archived ? sql`${contacts.archivedAt} IS NOT NULL` : isNull(contacts.archivedAt),
	];

	if (query.q) {
		const name = concatContains([contacts.firstName, contacts.lastName], query.q);
		const email = containsText(contacts.email, query.q);
		const wechat = containsText(contacts.wechatId, query.q);

		filters.push(sql`(${name} OR ${email} OR ${wechat})`);
	}

	// 关系维护筛选：__blank__ 是「默认」那一档，也就是长期养着的人。
	if (query.relationship === RELATIONSHIP_BLANK) {
		filters.push(isNull(contacts.relationshipState));
	} else if (query.relationship) {
		filters.push(eq(contacts.relationshipState, query.relationship));
	}

	const where = and(...filters);

	const [rows, totals] = await Promise.all([
		db()
			.select({ row: contacts, companyName: companies.name })
			.from(contacts)
			.leftJoin(companies, eq(companies.id, contacts.companyId))
			.where(where)
			.orderBy(desc(contacts.updatedAt))
			.limit(query.pageSize)
			.offset((query.page - 1) * query.pageSize),
		db().select({ total: count() }).from(contacts).where(where),
	]);

	const facts = await appliedFactMap(
		"contact",
		rows.map((item) => item.row.id),
	);

	return {
		items: rows.map((item) => ({
			...toContact(item.row),
			companyName: item.companyName ?? null,
			facts: facts.get(item.row.id) ?? {},
		})),
		total: Number(totals[0]?.total ?? 0),
		page: query.page,
		pageSize: query.pageSize,
	};
}

export async function getContact(id: string): Promise<Contact | null> {
	const [row] = await db().select().from(contacts).where(eq(contacts.id, id)).limit(1);

	return row ? toContact(row) : null;
}

/** 按姓名精确找未归档联系人（导入增量去重时定位索引源用，不建档）。 */
export async function findContactByName(name: string): Promise<Contact | null> {
	const trimmed = name.trim();
	if (!trimmed) return null;

	return findContactByColumn(contacts.firstName, trimmed);
}

export async function createContact(input: ContactInput): Promise<Contact> {
	const at = nowMs();
	const id = newId();

	await db().insert(contacts).values({
		id,
		companyId: input.companyId,
		firstName: input.firstName,
		lastName: input.lastName,
		title: input.title,
		email: input.email,
		phone: input.phone,
		wechatId: input.wechatId,
		address: input.address,
		country: input.country,
		postalCode: input.postalCode,
		customerGrade: input.customerGrade,
		businessRole: input.businessRole,
		relationshipState: input.relationshipState,
		repairNote: input.repairNote,
		linkedin: input.linkedin,
		github: input.github,
		notes: input.notes,
		createdAt: at,
		updatedAt: at,
	});

	await rememberRoleOption("contact", "business_role", input.businessRole);
	await rememberRoleOption("contact", "relationship_state", input.relationshipState);
	await rememberRoleOption("contact", "customer_grade", input.customerGrade);

	const created = await getContact(id);
	if (!created) throw new Error("联系人创建失败。");

	return created;
}

export type EnsureContactLookup = {
	name: string;
	wechatId: string | null;
	phone: string | null;
};

export type EnsureContactResult = {
	id: string;
	created: boolean;
	matchedBy: "wechat_id" | "phone" | "name" | null;
	name: string;
};

/** 归一化比较键：去空白、去常见分隔符、转小写。仅用于查重，不写回库。 */
function contactKey(value: string): string {
	return value.trim().toLowerCase().replace(/[\s\-()（）]/g, "");
}

async function findContactByColumn(
	column: typeof contacts.wechatId | typeof contacts.phone | typeof contacts.firstName,
	value: string,
): Promise<Contact | null> {
	const [row] = await db()
		.select()
		.from(contacts)
		.where(and(eq(column, value), isNull(contacts.archivedAt)))
		.limit(1);

	return row ? toContact(row) : null;
}

/**
 * 按「微信号 → 电话 → 姓名」的顺序查重并建档。
 * 只在所有键都未命中时才新建；命中即返回既有记录，绝不合并、绝不改写。
 */
export async function ensureContact(input: EnsureContactLookup): Promise<EnsureContactResult> {
	const name = input.name.trim();
	const wechatId = input.wechatId?.trim() || null;
	const phone = input.phone?.trim() || null;

	if (wechatId) {
		const hit = await findContactByColumn(contacts.wechatId, wechatId);
		if (hit) return { id: hit.id, created: false, matchedBy: "wechat_id", name: hit.firstName };
	}

	if (phone) {
		const direct = await findContactByColumn(contacts.phone, phone);
		if (direct) return { id: direct.id, created: false, matchedBy: "phone", name: direct.firstName };

		// 库里可能存成 189-2934-5383 这类写法，做一次归一化全表比对。
		const normalized = contactKey(phone);
		const candidates = await db()
			.select()
			.from(contacts)
			.where(isNull(contacts.archivedAt));

		const loose = candidates.find(
			(row) => row.phone !== null && contactKey(row.phone) === normalized,
		);

		if (loose) {
			return { id: loose.id, created: false, matchedBy: "phone", name: loose.firstName };
		}
	}

	const byName = await findContactByColumn(contacts.firstName, name);
	if (byName) return { id: byName.id, created: false, matchedBy: "name", name: byName.firstName };

	const created = await createContact({
		firstName: name,
		lastName: null,
		title: null,
		email: null,
		phone,
		wechatId,
		address: null,
		country: null,
		postalCode: null,
		customerGrade: null,
		businessRole: null,
		relationshipState: null,
		repairNote: null,
		linkedin: null,
		github: null,
		notes: null,
		companyId: null,
	});

	return { id: created.id, created: true, matchedBy: null, name: created.firstName };
}

export async function updateContact(id: string, input: ContactInput): Promise<Contact | null> {
	const existing = await getContact(id);
	if (!existing) return null;

	await db()
		.update(contacts)
		.set({
			companyId: input.companyId,
			firstName: input.firstName,
			lastName: input.lastName,
			title: input.title,
			email: input.email,
			phone: input.phone,
			wechatId: input.wechatId,
			address: input.address,
			country: input.country,
			postalCode: input.postalCode,
			customerGrade: input.customerGrade,
			businessRole: input.businessRole,
			relationshipState: input.relationshipState,
			// 关系恢复正常后把修复说明一起清掉，不留过期的旧说明。
			repairNote: input.relationshipState ? input.repairNote : null,
			linkedin: input.linkedin,
			github: input.github,
			notes: input.notes,
			updatedAt: nowMs(),
		})
		.where(eq(contacts.id, id));

	await rememberRoleOption("contact", "business_role", input.businessRole);
	await rememberRoleOption("contact", "relationship_state", input.relationshipState);
	await rememberRoleOption("contact", "customer_grade", input.customerGrade);

	return getContact(id);
}

export async function archiveContact(id: string): Promise<boolean> {
	const result = await db()
		.update(contacts)
		.set({ archivedAt: nowMs(), updatedAt: nowMs() })
		.where(and(eq(contacts.id, id), isNull(contacts.archivedAt)));

	return result[0].affectedRows > 0;
}

export async function restoreContact(id: string): Promise<boolean> {
	const existing = await getContact(id);
	if (!existing) return false;

	// 不靠 affectedRows 判断：把已经是 NULL 的 archived_at 再写成 NULL，
	// MySQL 算作「没有变化」返回 0，会被误判成记录不存在。
	await db()
		.update(contacts)
		.set({ archivedAt: null, updatedAt: nowMs() })
		.where(eq(contacts.id, id));

	return true;
}

/**
 * 把联系人挂到公司上。
 * 与 facts 通道不同，这是结构性归属：只在联系人当前没有公司时才写，
 * 已有公司时返回 linked=false，由人决定是否改挂，避免把人工的归属覆盖掉。
 */
export async function linkContactCompany(input: {
	contactId: string;
	companyId: string;
}): Promise<{ linked: boolean; reason: string; previousCompanyId: string | null }> {
	return db().transaction(async (tx) => {
		const [contact] = await tx
			.select()
			.from(contacts)
			.where(eq(contacts.id, input.contactId))
			.limit(1)
			.for("update");

		if (!contact) {
			return { linked: false, reason: "联系人不存在。", previousCompanyId: null };
		}

		const [company] = await tx
			.select({ id: companies.id })
			.from(companies)
			.where(eq(companies.id, input.companyId))
			.limit(1);

		if (!company) {
			return { linked: false, reason: "公司不存在。", previousCompanyId: contact.companyId };
		}

		if (contact.companyId === input.companyId) {
			return {
				linked: false,
				reason: "这位联系人本来就在这家公司名下，未做改动。",
				previousCompanyId: contact.companyId,
			};
		}

		if (contact.companyId) {
			return {
				linked: false,
				reason: "这位联系人已归属另一家公司，人工确认后再改。",
				previousCompanyId: contact.companyId,
			};
		}

		await tx
			.update(contacts)
			.set({ companyId: input.companyId, updatedAt: nowMs() })
			.where(eq(contacts.id, input.contactId));

		return { linked: true, reason: "已把联系人归到这家公司。", previousCompanyId: null };
	});
}

export async function contactCompany(companyId: string | null): Promise<Company | null> {	if (!companyId) return null;

	const [row] = await db().select().from(companies).where(eq(companies.id, companyId)).limit(1);

	return row ? toCompany(row) : null;
}

export async function contactFactsFor(contactId: string): Promise<ContactFact[]> {
	const rows = await db()
		.select()
		.from(contactFacts)
		.where(eq(contactFacts.contactId, contactId))
		.orderBy(desc(contactFacts.createdAt));

	return rows.map(toFact);
}

export async function contactDeals(contactId: string): Promise<Deal[]> {
	const rows = await db()
		.select()
		.from(deals)
		.where(and(eq(deals.contactId, contactId), isNull(deals.archivedAt)))
		.orderBy(desc(deals.updatedAt));

	return rows.map(toDeal);
}

export async function contactActivities(contactId: string, limit: number): Promise<Activity[]> {
	const rows = await db()
		.select()
		.from(activities)
		.where(eq(activities.contactId, contactId))
		.orderBy(desc(activities.createdAt))
		.limit(limit);

	return rows.map(toActivity);
}

export async function contactIsResearching(contactId: string): Promise<boolean> {
	const [row] = await db()
		.select({ id: agentTasks.id })
		.from(agentTasks)
		.where(
			and(
				eq(agentTasks.targetId, contactId),
				// 只算真正在推进的：未来的复查预约是排期，不该让详情页显示「正在研究」。
				sql`${agentTasks.status} IN ('pending', 'running')`,
				sql`(${agentTasks.status} = 'running' OR ${agentTasks.runAt} IS NULL OR ${agentTasks.runAt} <= ${nowMs()})`,
			),
		)
		.limit(1);

	return Boolean(row);
}

export async function contactDetail(id: string): Promise<ContactDetail | null> {
	const contact = await getContact(id);
	if (!contact) return null;

	const [company, deals, activities, facts, researching, archives, insights, promises] =
		await Promise.all([
			contactCompany(contact.companyId),
			contactDeals(id),
			contactActivities(id, 50),
			contactFactsFor(id),
			contactIsResearching(id),
			intakeArchives(id),
			latestInsights(id),
			allPromises(id),
		]);

	return { contact, company, deals, activities, facts, researching, archives, insights, promises };
}
