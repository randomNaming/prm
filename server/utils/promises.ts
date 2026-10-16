import { and, desc, eq, inArray } from "drizzle-orm";
import type { Evidence, PromiseDirection, PromiseItem, PromiseStatus } from "../../app/types/domain";
import { PROMISE_DIRECTIONS } from "../../app/types/domain";
import { promises } from "../db/schema";
import { db } from "./db";
import { newId, nowMs } from "./ids";
import { parseEvidence } from "./parse";

/**
 * 双向承诺与期权账本。
 *
 * 只记 open，闭环由人在界面上确认（或下一次导入时智能体不再重复建同一条 ——
 * 去重靠「同联系人 + 同方向 + 同标题」命中即跳过）。
 */

export type RecordPromiseResult = {
	stored: boolean;
	promiseId: string | null;
	reason: string;
};

/** 承诺标题的比较键：去括号补充说明、去标点符号空白、小写 —— 「8% 折扣（致歉）」和「8% 折扣（补偿）」是同一条。 */
function normalizeTitle(value: string): string {
	return value
		.toLowerCase()
		.replace(/（[^）]*）|\([^)]*\)/g, "")
		.replace(/[\s\p{P}\p{S}]+/gu, "")
		.trim();
}

export async function recordPromise(input: {
	contactId: string;
	direction: PromiseDirection;
	title: string;
	detail?: string | null;
	dueHint?: string | null;
	evidence: Evidence[];
	source?: string;
}): Promise<RecordPromiseResult> {
	const title = input.title.trim().slice(0, 191);

	if (!PROMISE_DIRECTIONS.includes(input.direction)) {
		return { stored: false, promiseId: null, reason: "承诺方向只能是 ours 或 theirs。" };
	}

	const normalized = normalizeTitle(title);

	const existing = await db()
		.select({ id: promises.id, title: promises.title })
		.from(promises)
		.where(
			and(
				eq(promises.contactId, input.contactId),
				eq(promises.direction, input.direction),
				inArray(promises.status, ["open", "fulfilled"]),
			),
		);

	// 去重两层：归一化后同文直接判重；双方都够长时互相包含也算同一条
	// （拦「8% 折扣（致歉）」vs「8% 折扣（补偿）」这类换措辞重记）。
	const duplicate = existing.find((row) => {
		const other = normalizeTitle(row.title);
		if (!other || !normalized) return false;
		if (other === normalized) return true;
		return other.length >= 6 && normalized.length >= 6 && (other.includes(normalized) || normalized.includes(other));
	});

	if (duplicate) {
		return {
			stored: false,
			promiseId: duplicate.id,
			reason: `这条承诺已经在账本里（「${duplicate.title}」），不重复记。`,
		};
	}

	const id = newId();

	await db().insert(promises).values({
		id,
		contactId: input.contactId,
		direction: input.direction,
		title,
		detail: input.detail?.trim().slice(0, 191) || null,
		dueHint: input.dueHint?.trim().slice(0, 64) || null,
		status: "open",
		evidence: input.evidence,
		source: input.source ?? "agent",
		createdAt: nowMs(),
	});

	return { stored: true, promiseId: id, reason: "已记入承诺账本。" };
}

export async function openPromises(contactId: string): Promise<PromiseItem[]> {
	const rows = await db()
		.select()
		.from(promises)
		.where(and(eq(promises.contactId, contactId), eq(promises.status, "open")))
		.orderBy(desc(promises.createdAt));

	return rows.map(toPromiseItem);
}

export async function allPromises(contactId: string): Promise<PromiseItem[]> {
	const rows = await db()
		.select()
		.from(promises)
		.where(eq(promises.contactId, contactId))
		.orderBy(desc(promises.createdAt));

	return rows.map(toPromiseItem);
}

export async function closePromise(input: {
	promiseId: string;
	action: "fulfilled" | "cancelled";
	note?: string | null;
}): Promise<{ ok: boolean; reason: string }> {
	const [row] = await db()
		.select()
		.from(promises)
		.where(eq(promises.id, input.promiseId))
		.limit(1);

	if (!row) return { ok: false, reason: "承诺不存在。" };
	if (row.status !== "open") return { ok: false, reason: "这条承诺已经闭环了。" };

	await db()
		.update(promises)
		.set({
			status: input.action,
			closedAt: nowMs(),
			closedNote: input.note?.trim().slice(0, 191) || null,
		})
		.where(eq(promises.id, input.promiseId));

	return {
		ok: true,
		reason: input.action === "fulfilled" ? "已标记兑现。" : "已关闭。",
	};
}

function toPromiseItem(row: typeof promises.$inferSelect): PromiseItem {
	return {
		id: row.id,
		contactId: row.contactId,
		direction: row.direction as PromiseDirection,
		title: row.title,
		detail: row.detail,
		dueHint: row.dueHint,
		status: row.status as PromiseStatus,
		evidence: parseEvidence(row.evidence),
		source: row.source,
		createdAt: row.createdAt,
		closedAt: row.closedAt,
		closedNote: row.closedNote,
	};
}

/** 副驾驶与研究上下文用：把开放承诺压成一行一条的提示词文本。 */
export function describePromises(items: PromiseItem[]): string[] {
	return items.map((item) => {
		const direction = item.direction === "ours" ? "我方欠对方" : "对方许我方";
		const due = item.dueHint ? `（触发条件：${item.dueHint}）` : "";

		return `${direction}：${item.title}${due}`;
	});
}
