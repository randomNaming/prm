import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { BOARD_QUADRANTS, type Board, type BoardItem, type BoardQuadrant } from "../app/types/domain";
import { activities, boardPins, deals } from "../server/db/schema";
import { createActivity } from "../server/utils/activities";
import { board, pinItem } from "../server/utils/board";
import { CONFIG } from "../server/utils/config";
import { createDeal } from "../server/utils/deals";
import { recordInsight } from "../server/utils/insights";
import { closePromise, recordPromise } from "../server/utils/promises";
import { closeDb, db } from "../server/utils/db";
import { contactFixture, evidence, resetDatabase } from "./helpers";

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

async function task(input: { title: string; dueAt: number | null; contactId?: string | null }) {
	return createActivity({
		kind: "task",
		title: input.title,
		body: null,
		contactId: input.contactId ?? null,
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

describe("四象限：事务健康度联动升舱", () => {
	/** 建一位事务健康度负面的联系人（默认 Frustrated / -60，即实机 Michael Wake 的处境）。 */
	async function poorHealthContact(level = "Frustrated", score = -60) {
		const contact = await contactFixture({ firstName: "Michael", lastName: "Wake" });

		await recordInsight({
			contactId: contact.id,
			kind: "dual_track",
			payload: {
				transaction_health: {
					level,
					score,
					note: "发货第 15 天仍未收到，物流绕道墨尔本",
					quote: "i am just frustrated",
					time: "2026-10-13 09:15",
				},
				personal_trust: {
					level: "High",
					score: 70,
					note: "虽不满物流但明确体谅我方的努力",
					quote: "I know you are trying, i am just frustrated",
					time: "2026-10-13 09:15",
				},
			},
			evidence: [evidence("wechat.chat", "i am just frustrated", null, "2026-10-13 09:15")],
		});

		return contact;
	}

	test("Frustrated 客户的「每日盯物流并立即通知」承诺强制进第一象限（实机 Bug 复现）", async () => {
		const contact = await poorHealthContact();
		const created = await recordPromise({
			contactId: contact.id,
			direction: "ours",
			title: "每日盯物流并在到达/派送时立即通知",
			dueHint: "到达/派送时",
			evidence: [evidence()],
		});

		const result = await board();
		const promiseId = created.promiseId ?? "";

		expect(quadrantOf(result, "promise", promiseId)).toBe("urgent_important");
		expect(itemOf(result, "promise", promiseId)?.badge).toContain("Frustrated");
	});

	test("健康客户的同一条承诺仍按默认落「重要不紧急」——没有证据不升舱", async () => {
		const contact = await contactFixture({ firstName: "没事的", lastName: "客户" });
		const created = await recordPromise({
			contactId: contact.id,
			direction: "ours",
			title: "每日盯物流并在到达/派送时立即通知",
			dueHint: "到达/派送时",
			evidence: [evidence()],
		});

		expect(quadrantOf(await board(), "promise", created.promiseId ?? "")).toBe("important");
	});

	test("Frustrated 客户的远期承诺（下一单折扣）保留在「重要不紧急」", async () => {
		const contact = await poorHealthContact();
		const future = await recordPromise({
			contactId: contact.id,
			direction: "ours",
			title: "下一单给 8% 折扣补偿",
			dueHint: "下一单",
			evidence: [evidence()],
		});
		const plain = await recordPromise({
			contactId: contact.id,
			direction: "ours",
			title: "未来订单改香港直飞珀斯航线",
			evidence: [evidence()],
		});

		const result = await board();

		expect(quadrantOf(result, "promise", future.promiseId ?? "")).toBe("important");
		expect(quadrantOf(result, "promise", plain.promiseId ?? "")).toBe("important");
	});

	test("对方许的承诺即使带高频语义也不升舱", async () => {
		const contact = await poorHealthContact();
		const created = await recordPromise({
			contactId: contact.id,
			direction: "theirs",
			title: "每日同步物流进展",
			evidence: [evidence()],
		});

		expect(quadrantOf(await board(), "promise", created.promiseId ?? "")).toBe("neither");
	});

	test("Frustrated 客户名下未到期/无截止日的跟进任务全部升舱进第一象限", async () => {
		const contact = await poorHealthContact();
		const future = await task({
			title: "查订单澳洲段物流并同步",
			dueAt: Date.now() + 3 * DAY,
			contactId: contact.id,
		});
		const someday = await task({ title: "盯派送节点", dueAt: null, contactId: contact.id });

		const result = await board();

		expect(quadrantOf(result, "task", future.id)).toBe("urgent_important");
		expect(quadrantOf(result, "task", someday.id)).toBe("urgent_important");
		expect(itemOf(result, "task", future.id)?.badge).toContain("客户Frustrated");
	});

	test("健康度分值低于 40 也算负面（分级词中性时靠分数兜底）", async () => {
		const contact = await poorHealthContact("Medium", 30);
		const created = await recordPromise({
			contactId: contact.id,
			direction: "ours",
			title: "每日盯物流并立即通知",
			evidence: [evidence()],
		});

		expect(quadrantOf(await board(), "promise", created.promiseId ?? "")).toBe("urgent_important");
	});

	test("升舱是推断值：手工拖走后仍然说话算数，拖回即恢复", async () => {
		const contact = await poorHealthContact();
		const created = await recordPromise({
			contactId: contact.id,
			direction: "ours",
			title: "每日盯物流并立即通知",
			evidence: [evidence()],
		});
		const promiseId = created.promiseId ?? "";
		const before = itemOf(await board(), "promise", promiseId);
		expect(before?.inferred).toBe("urgent_important");

		await pinItem({
			type: "promise",
			id: promiseId,
			quadrant: "important",
			inferred: before?.inferred ?? "urgent_important",
		});

		const after = await board();
		expect(quadrantOf(after, "promise", promiseId)).toBe("important");
		expect(itemOf(after, "promise", promiseId)?.pinned).toBe(true);
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

describe("承诺账本进看板", () => {
	test("我方欠的进「重要不紧急」，对方许的进「不重要不紧急」", async () => {
		const contact = await contactFixture();
		await recordPromise({
			contactId: contact.id,
			direction: "ours",
			title: "下一单给 8% 折扣补偿",
			dueHint: "下一单",
			evidence: [evidence()],
		});
		await recordPromise({
			contactId: contact.id,
			direction: "theirs",
			title: "签收核验后给好评",
			evidence: [evidence()],
		});

		const result = await board();

		const ours = result.columns
			.find((column) => column.quadrant === "important")
			?.items.find((item) => item.type === "promise");
		expect(ours?.title).toBe("下一单给 8% 折扣补偿");
		expect(ours?.detail).toContain("我方欠");

		const theirs = result.columns
			.find((column) => column.quadrant === "neither")
			?.items.find((item) => item.type === "promise");
		expect(theirs?.title).toBe("签收核验后给好评");
		expect(theirs?.detail).toContain("对方许");
	});

	test("承诺闭环后从看板消失", async () => {
		const contact = await contactFixture();
		const created = await recordPromise({
			contactId: contact.id,
			direction: "ours",
			title: "明早9点催物流",
			evidence: [evidence()],
		});

		expect((await board()).columns.some((column) => column.items.some((item) => item.type === "promise"))).toBe(true);

		await closePromise({ promiseId: created.promiseId ?? "", action: "fulfilled" });

		expect((await board()).columns.some((column) => column.items.some((item) => item.type === "promise"))).toBe(false);
	});

	test("已取消的承诺同样不上看板", async () => {
		const contact = await contactFixture();
		const created = await recordPromise({
			contactId: contact.id,
			direction: "theirs",
			title: "复购 100 件",
			evidence: [evidence()],
		});

		await closePromise({ promiseId: created.promiseId ?? "", action: "cancelled" });

		const result = await board();
		const promiseItems = result.columns.flatMap((column) => column.items).filter((item) => item.type === "promise");
		expect(promiseItems).toHaveLength(0);
	});
});
