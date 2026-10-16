import { and, desc, eq, isNull } from "drizzle-orm";
import {
	BOARD_QUADRANTS,
	BOARD_QUADRANT_LABELS,
	RELATIONSHIP_REPAIR,
	type Board,
	type BoardColumn,
	type BoardItem,
	type BoardItemType,
	type BoardQuadrant,
} from "../../app/types/domain";
import { activities, boardPins, contacts, deals, promises as promisesTable } from "../db/schema";
import { CONFIG } from "./config";
import { db } from "./db";
import { nowMs } from "./ids";

/**
 * 首页四象限看板。
 *
 * 象限自动推断，拖拽可以覆盖 —— 覆盖只存进 board_pins，不污染 activities / deals / contacts。
 * 推断规则刻意做得粗：它只是默认值，猜错了你拖一下就行。
 */

const DAY_MS = CONFIG.time.dayMs;

/**
 * 汇总出来的原始事项：只有推断值，没有生效值。
 *
 * 刻意把 `quadrant` / `pinned` 排除在类型外 —— 生效象限一律由 applyPins 填，
 * 这样「忘了用推断值兜底」这种错在编译期就写不出来。
 */
type RawBoardItem = Omit<BoardItem, "quadrant" | "pinned">;

function daysSince(at: number | null, now: number): number {
	if (!at) return 0;

	return Math.max(0, Math.floor((now - at) / DAY_MS));
}

/** 取整张 pin 表，量很小（只存拖过的），一次读完在内存里比对。 */
async function pinnedQuadrants(): Promise<Map<string, BoardQuadrant>> {
	const rows = await db().select().from(boardPins);
	const table = new Map<string, BoardQuadrant>();

	for (const row of rows) {
		table.set(`${row.itemType}:${row.itemId}`, row.quadrant as BoardQuadrant);
	}

	return table;
}

function pinKey(type: BoardItemType, id: string): string {
	return `${type}:${id}`;
}

async function taskItems(now: number): Promise<RawBoardItem[]> {
	const rows = await db()
		.select({
			id: activities.id,
			title: activities.title,
			body: activities.body,
			dueAt: activities.dueAt,
			contactId: activities.contactId,
			contactFirst: contacts.firstName,
			contactLast: contacts.lastName,
		})
		.from(activities)
		.leftJoin(contacts, eq(activities.contactId, contacts.id))
		.where(and(eq(activities.kind, "task"), isNull(activities.completedAt)))
		.orderBy(activities.dueAt)
		.limit(CONFIG.board.taskLimit);

	return rows.map((row) => {
		const overdueDays = row.dueAt ? daysSince(row.dueAt, now) : 0;

		return {
			type: "task" as const,
			id: row.id,
			title: row.title,
			detail: row.contactFirst ? `${row.contactFirst}${row.contactLast ?? ""}` : null,
			badge: row.dueAt
				? overdueDays > 0
					? `逾期 ${overdueDays} 天`
					: "未到期"
				: "无截止日",
			to: row.contactId ? `/contacts/${row.contactId}` : "/",
			// 逾期才是紧急；没有截止日的任务一律算不紧急，靠拖拽决定。
			inferred: overdueDays > 0 ? ("urgent_important" as const) : ("important" as const),
			weight: overdueDays,
		};
	});
}

async function dealItems(now: number): Promise<RawBoardItem[]> {
	const rows = await db()
		.select()
		.from(deals)
		.where(and(isNull(deals.archivedAt), eq(deals.status, "open")))
		.orderBy(desc(deals.updatedAt))
		.limit(CONFIG.board.dealLimit);

	return rows.map((row) => {
		const stalledDays = daysSince(row.stageChangedAt ?? row.updatedAt, now);
		const stalled = stalledDays >= CONFIG.board.stalledDealDays;

		return {
			type: "deal" as const,
			id: row.id,
			title: row.name,
			detail: `商机 · ${row.stage}`,
			badge: stalled ? `停留 ${stalledDays} 天` : null,
			to: `/deals/${row.id}`,
			// 停滞太久就是紧急：要么推一下，要么关掉。
			inferred: stalled ? ("urgent_important" as const) : ("important" as const),
			weight: stalledDays,
		};
	});
}

async function contactItems(): Promise<RawBoardItem[]> {
	const rows = await db()
		.select()
		.from(contacts)
		.where(isNull(contacts.archivedAt))
		.orderBy(desc(contacts.updatedAt))
		.limit(CONFIG.board.contactLimit);

	return rows
		.filter((row) => row.relationshipState !== null)
		.map((row) => {
			// 「重点维护」是唯一一个不该落进「不重要」的标记：它字面意思就是重要。
			// 其余（关系待修复 / 暂缓联系 / 自定义标签）按使用者定的规矩统一归第四象限，
			// 真出事了再拖到第一象限 —— 拖拽就是为这个准备的。
			const isKeyAccount = row.relationshipState === "重点维护";

			return {
				type: "contact" as const,
				id: row.id,
				title: `${row.firstName}${row.lastName ?? ""}`,
				detail: row.repairNote
					? `${row.relationshipState}：${row.repairNote}`
					: row.relationshipState,
				// badge 直接用状态原文：第四象限的词条显示「{姓名}{状态}」整句，
				// 比如「David McGowan关系待修复」；重点维护是好事，不挂红字。
				badge:
					row.relationshipState === RELATIONSHIP_REPAIR || !isKeyAccount
						? row.relationshipState
						: null,
				to: `/contacts/${row.id}`,
				inferred: isKeyAccount ? ("important" as const) : ("neither" as const),
				weight: 0,
			};
		});
}

/**
 * 承诺账本进看板：我方欠的进「重要不紧急」（要排期兑现），
 * 对方许的进「不重要不紧急」（待收割的期权，不急）。
 */
async function promiseItems(): Promise<RawBoardItem[]> {
	const rows = await db()
		.select()
		.from(promisesTable)
		.where(eq(promisesTable.status, "open"))
		.orderBy(desc(promisesTable.createdAt))
		.limit(CONFIG.board.promiseLimit);

	return rows.map((row) => {
		const ours = row.direction === "ours";

		return {
			type: "promise" as const,
			id: row.id,
			title: row.title,
			detail: [
				ours ? "我方欠" : "对方许",
				row.dueHint,
				row.detail,
			]
				.filter(Boolean)
				.join(" · "),
			badge: null,
			to: `/contacts/${row.contactId}`,
			inferred: ours ? ("important" as const) : ("neither" as const),
			weight: 0,
		};
	});
}

function applyPins(items: RawBoardItem[], pins: Map<string, BoardQuadrant>): BoardItem[] {
	return items.map((item) => {
		const pinned = pins.get(pinKey(item.type, item.id));
		if (!pinned) return { ...item, quadrant: item.inferred, pinned: false };

		return { ...item, quadrant: pinned, pinned: true };
	});
}

export async function board(now = nowMs()): Promise<Board> {
	const [tasks, dealRows, contactRows, promiseRows, pins] = await Promise.all([
		taskItems(now),
		dealItems(now),
		contactItems(),
		promiseItems(),
		pinnedQuadrants(),
	]);

	const items = applyPins([...tasks, ...dealRows, ...contactRows, ...promiseRows], pins);

	const columns: BoardColumn[] = BOARD_QUADRANTS.map((quadrant) => ({
		quadrant,
		label: BOARD_QUADRANT_LABELS[quadrant],
		items: items
			.filter((item) => item.quadrant === quadrant)
			// 越紧急越靠前；同类里按权重（逾期/停滞天数）降序，再按标题稳定排序。
			.sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title))
			.slice(0, CONFIG.board.maxItemsPerQuadrant),
	}));

	return {
		columns,
		pinnedCount: items.filter((item) => item.pinned).length,
	};
}

export type PinResult = {
	ok: boolean;
	reason: string;
	/** 这次之后是否还留着覆盖（拖回它本来该在的象限 = 恢复自动）。 */
	pinned: boolean;
};

/**
 * 把一件事拖到某个象限。
 *
 * 拖到的象限如果正好等于系统推断值，就把覆盖删掉 —— 等于「恢复自动」，
 * 不需要额外做一个「重置」按钮。
 */
export async function pinItem(input: {
	type: BoardItemType;
	id: string;
	quadrant: BoardQuadrant;
	inferred: BoardQuadrant;
}): Promise<PinResult> {
	if (!BOARD_QUADRANTS.includes(input.quadrant)) {
		return { ok: false, reason: "没有这个象限。", pinned: false };
	}

	if (input.quadrant === input.inferred) {
		await db()
			.delete(boardPins)
			.where(and(eq(boardPins.itemType, input.type), eq(boardPins.itemId, input.id)));

		return { ok: true, reason: "已恢复自动判定。", pinned: false };
	}

	await db()
		.insert(boardPins)
		.values({
			itemType: input.type,
			itemId: input.id,
			quadrant: input.quadrant,
			updatedAt: nowMs(),
		})
		.onDuplicateKeyUpdate({
			set: { quadrant: input.quadrant, updatedAt: nowMs() },
		});

	return { ok: true, reason: "已移动。", pinned: true };
}
