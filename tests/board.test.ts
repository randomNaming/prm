import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { BOARD_QUADRANTS, type Board, type BoardItem, type BoardQuadrant } from "../app/types/domain";
import { activities, boardPins, deals } from "../server/db/schema";
import { createActivity } from "../server/utils/activities";
import { board, pinItem } from "../server/utils/board";
import { CONFIG } from "../server/utils/config";
import { createDeal } from "../server/utils/deals";
import { closeDb, db } from "../server/utils/db";
import { contactFixture, resetDatabase } from "./helpers";

const DAY = CONFIG.time.dayMs;

beforeEach(async () => {
	await resetDatabase();
});

afterAll(async () => {
	await closeDb();
});

function quadrantOf(result: Board, type: BoardItem["type"], id: string): BoardQuadrant | null {
	for (const column of result.columns) {
		if (column.items.some((item) => item.type === type && item.id === id)) return column.quadrant;
	}

	return null;
}

function itemOf(result: Board, type: BoardItem["type"], id: string): BoardItem | null {
	for (const column of result.columns) {
		const found = column.items.find((item) => item.type === type && item.id === id);
		if (found) return found;
	}

	return null;
}

async function task(input: { title: string; dueAt: number | null }) {
	return createActivity({
		kind: "task",
		title: input.title,
		body: null,
		contactId: null,
		companyId: null,
		dealId: null,
		dueAt: input.dueAt,
	});
}

describe("四象限：推断规则", () => {
	test("逾期的任务落「紧急且重要」，并带上逾期天数", async () => {
		const overdue = await task({ title: "催尾款", dueAt: Date.now() - 5 * DAY });
		const result = await board();

		expect(quadrantOf(result, "task", overdue.id)).toBe("urgent_important");
		expect(itemOf(result, "task", overdue.id)?.badge).toContain("逾期 5 天");
	});

	test("没到期的任务落「重要不紧急」", async () => {
		const later = await task({ title: "下周回访", dueAt: Date.now() + 3 * DAY });
		const result = await board();

		expect(quadrantOf(result, "task", later.id)).toBe("important");
	});

	test("没有截止日的任务不算紧急 —— 不靠猜", async () => {
		const someday = await task({ title: "有空整理名片", dueAt: null });
		const result = await board();

		expect(quadrantOf(result, "task", someday.id)).toBe("important");
	});

	test("停滞超过阈值的商机算紧急，新鲜的算重要不紧急", async () => {
		const stalled = await createDeal({
			name: "停滞的单",
			companyId: null,
			contactId: null,
			stage: "谈判",
			expectedCloseDate: null,
		});
		const fresh = await createDeal({
			name: "刚推进的单",
			companyId: null,
			contactId: null,
			stage: "需求确认",
			expectedCloseDate: null,
		});

		// 把停滞的那条阶段变更时间往前推，模拟躺了很久。
		const stale = Date.now() - (CONFIG.board.stalledDealDays + 3) * DAY;
		await db().update(deals).set({ stageChangedAt: stale, updatedAt: stale }).where(eq(deals.id, stalled.id));

		const result = await board();

		expect(quadrantOf(result, "deal", stalled.id)).toBe("urgent_important");
		expect(quadrantOf(result, "deal", fresh.id)).toBe("important");
	});

	test("标了关系维护的联系人落「不重要不紧急」，且只在标了之后才上看板", async () => {
		const plain = await contactFixture({ firstName: "没标的" });
		const repair = await contactFixture({
			firstName: "有差评的",
			relationshipState: "关系待修复",
			repairNote: "等精度达标的新品",
		});

		const result = await board();

		// 没标的人根本不进看板 —— 看板只放「需要你决定怎么处置」的东西。
		expect(quadrantOf(result, "contact", plain.id)).toBeNull();
		expect(quadrantOf(result, "contact", repair.id)).toBe("neither");
		expect(itemOf(result, "contact", repair.id)?.detail).toContain("等精度达标的新品");
	});

	test("「重点维护」是例外：字面意思就是重要，不落进「不重要」", async () => {
		const vip = await contactFixture({ firstName: "大客户", relationshipState: "重点维护" });
		const result = await board();

		expect(quadrantOf(result, "contact", vip.id)).toBe("important");
	});

	test("已完成的任务不再出现在看板上", async () => {
		const done = await task({ title: "已经做完了", dueAt: Date.now() - DAY });
		await db().update(activities).set({ completedAt: Date.now() }).where(eq(activities.id, done.id));

		const result = await board();

		expect(quadrantOf(result, "task", done.id)).toBeNull();
	});

	test("四个象限一直都在，空的也返回，界面上不会缺格", async () => {
		const result = await board();

		expect(result.columns.map((column) => column.quadrant)).toEqual([...BOARD_QUADRANTS]);
		expect(result.columns.every((column) => column.label.length > 0)).toBe(true);
	});

	test("「紧急不重要」系统推断不出来，默认是空的，靠拖拽", async () => {
		await task({ title: "逾期的", dueAt: Date.now() - DAY });
		await contactFixture({ firstName: "标的", relationshipState: "暂缓联系" });

		const result = await board();
		const urgent = result.columns.find((column) => column.quadrant === "urgent");

		expect(urgent?.items).toHaveLength(0);
	});
});

describe("四象限：拖拽覆盖", () => {
	test("拖到别的象限后，看板按手工的走", async () => {
		const repair = await contactFixture({ firstName: "被拖上来的", relationshipState: "关系待修复" });
		const before = await board();
		const inferred = itemOf(before, "contact", repair.id)?.inferred ?? "neither";

		const pinned = await pinItem({
			type: "contact",
			id: repair.id,
			quadrant: "urgent_important",
			inferred,
		});
		expect(pinned.pinned).toBe(true);

		const after = await board();
		expect(quadrantOf(after, "contact", repair.id)).toBe("urgent_important");
		expect(itemOf(after, "contact", repair.id)?.pinned).toBe(true);
		expect(after.pinnedCount).toBe(1);
	});

	test("拖回它本来该在的位置 = 恢复自动，覆盖被删掉", async () => {
		const repair = await contactFixture({ firstName: "拖回来", relationshipState: "关系待修复" });
		const inferred = itemOf(await board(), "contact", repair.id)?.inferred ?? "neither";

		await pinItem({ type: "contact", id: repair.id, quadrant: "urgent_important", inferred });
		expect(await db().select().from(boardPins)).toHaveLength(1);

		const restored = await pinItem({
			type: "contact",
			id: repair.id,
			quadrant: inferred,
			inferred,
		});

		expect(restored.pinned).toBe(false);
		expect(await db().select().from(boardPins)).toHaveLength(0);
	});

	test("重复拖同一项不会堆出多行", async () => {
		const repair = await contactFixture({ firstName: "拖两次", relationshipState: "关系待修复" });
		const inferred = itemOf(await board(), "contact", repair.id)?.inferred ?? "neither";

		await pinItem({ type: "contact", id: repair.id, quadrant: "urgent_important", inferred });
		await pinItem({ type: "contact", id: repair.id, quadrant: "urgent", inferred });

		const rows = await db().select().from(boardPins);
		expect(rows).toHaveLength(1);
		expect(rows[0].quadrant).toBe("urgent");
	});

	test("推断值本身变了，手工覆盖依然优先", async () => {
		const t = await createActivity({
			kind: "task",
			title: "先不紧急后紧急",
			body: null,
			contactId: null,
			companyId: null,
			dealId: null,
			dueAt: Date.now() + 3 * DAY,
		});

		// 未到期 → 推断「重要不紧急」，手工拖到第四象限。
		await pinItem({ type: "task", id: t.id, quadrant: "neither", inferred: "important" });

		// 时间过去，它逾期了，推断值变成「紧急且重要」……
		await db()
			.update(activities)
			.set({ dueAt: Date.now() - 2 * DAY })
			.where(eq(activities.id, t.id));

		const result = await board();
		const item = itemOf(result, "task", t.id);

		// ……但你手工摆的位置仍然说话算数。
		expect(item?.inferred).toBe("urgent_important");
		expect(item?.quadrant).toBe("neither");
	});
});
