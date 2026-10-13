import { and, desc, eq, inArray, like } from "drizzle-orm";
import type { IntakeArchive } from "../../app/types/domain";
import { conversations, messages } from "../db/schema";
import { db } from "./db";

/**
 * 聊天导入留底。
 *
 * 原文只存在 messages 里（导入会话的第一条 user 消息），这里负责两件事：
 *   1. 导入时把「覆盖了哪段时间、多少条、来源哪份文件」算出来写进会话标题；
 *   2. 读的时候只带索引信息，不把动辄上万字的原文塞进详情接口。
 */
export const INTAKE_TITLE_PREFIX = "微信记录导入：";

/** 阿里国际站导出的一行消息头：[2026-08-18 09:16]。 */
const MESSAGE_LINE = /^\[(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}\]/gm;

export type IntakeDigest = {
	/** 第一行消息的日期。识别不出格式时为 null，界面显示「—」。 */
	from: string | null;
	/** 最后一行消息的日期。 */
	to: string | null;
	/** 认出来的消息条数。0 表示这份导出不是逐行带时间戳的格式。 */
	messageCount: number;
};

export function digestIntakeText(text: string): IntakeDigest {
	const dates = [...text.matchAll(MESSAGE_LINE)].map((match) => match[1]);

	return {
		from: dates[0] ?? null,
		to: dates.at(-1) ?? null,
		messageCount: dates.length,
	};
}

/**
 * 会话标题同时充当留底的索引。
 *
 * 这么做是为了不新增列：标题本来就要显示，把「条数 + 覆盖区间」放进去，
 * 列表页只读标题就能回答「上次聊到哪天」。
 */
export function intakeTitle(person: string, digest: IntakeDigest): string {
	const range =
		digest.from && digest.to
			? digest.from === digest.to
				? digest.from
				: `${digest.from} ~ ${digest.to}`
			: null;

	const detail = [digest.messageCount > 0 ? `${digest.messageCount} 条` : null, range]
		.filter(Boolean)
		.join("，");

	const title = detail
		? `${INTAKE_TITLE_PREFIX}${person}（${detail}）`
		: `${INTAKE_TITLE_PREFIX}${person}`;

	// conversations.title 是 VARCHAR(191)。
	return title.slice(0, 191);
}

export async function intakeArchives(contactId: string): Promise<IntakeArchive[]> {
	const rows = await db()
		.select({
			id: conversations.id,
			title: conversations.title,
			createdAt: conversations.createdAt,
		})
		.from(conversations)
		.where(
			and(
				eq(conversations.contactId, contactId),
				like(conversations.title, `${INTAKE_TITLE_PREFIX}%`),
			),
		)
		.orderBy(desc(conversations.createdAt))
		.limit(50);

	if (rows.length === 0) return [];

	// 摘要就是那一轮的 assistant 正文，很短，取回来不会有负担。
	const summaryRows = await db()
		.select({ conversationId: messages.conversationId, content: messages.content })
		.from(messages)
		.where(
			and(
				inArray(
					messages.conversationId,
					rows.map((row) => row.id),
				),
				eq(messages.role, "assistant"),
			),
		)
		.orderBy(desc(messages.createdAt));

	const summaries = new Map<string, string>();
	for (const row of summaryRows) {
		if (row.content && !summaries.has(row.conversationId)) {
			summaries.set(row.conversationId, row.content);
		}
	}

	return rows.map((row) => ({
		conversationId: row.id,
		title: row.title ?? INTAKE_TITLE_PREFIX,
		importedAt: row.createdAt ?? 0,
		summary: summaries.get(row.id) ?? null,
	}));
}
