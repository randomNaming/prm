import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, like } from "drizzle-orm";
import type { IntakeArchive } from "../../app/types/domain";
import { conversations, messages } from "../db/schema";
import { db } from "./db";
import { nowMs } from "./ids";

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
			viewedAt: conversations.viewedAt,
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
		viewedAt: row.viewedAt ?? null,
		summary: summaries.get(row.id) ?? null,
	}));
}

/**
 * 增量指纹去重（「增量二次导入」设计第 2、3 条的落地）。
 *
 * 客户端每次同步都转发整个会话（全量），服务端在这里把「已入库的消息」减掉，
 * 只把新增的几条喂给模型——省 token、省时间，也避免旧事重提产生重复洞察。
 * 指纹 = 归一化（小写、压空白）后的整条消息哈希：消息被撤回/编辑会得到新指纹，
 * 视为新增，这是特性而非缺陷。
 */

const MESSAGE_HEADER = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/;

export function splitMessageBlocks(text: string): { preamble: string; blocks: string[] } | null {
	const lines = text.split(/\r?\n/);
	const headerIdx = lines.findIndex((line) => MESSAGE_HEADER.test(line));
	// 认不出逐条格式的导出：无法指纹化，返回 null，调用方整段按新增处理。
	if (headerIdx === -1) return null;

	const preamble = lines.slice(0, headerIdx).join("\n");
	const blocks: string[] = [];
	let current: string[] = [];

	for (const line of lines.slice(headerIdx)) {
		if (MESSAGE_HEADER.test(line) && current.length > 0) {
			blocks.push(current.join("\n").trim());
			current = [];
		}
		current.push(line);
	}
	if (current.length > 0) blocks.push(current.join("\n").trim());

	return { preamble, blocks };
}

function messageFingerprint(block: string): string {
	const normalized = block.toLowerCase().replace(/\s+/g, " ").trim();
	return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

/** 留底原文带 buildIntakeMessage 的头部/分隔线/尾部包装，比对时剥掉，只留聊天正文。 */
function stripIntakeWrapper(stored: string): string {
	const first = stored.indexOf("\n---\n");
	const last = stored.lastIndexOf("\n---\n");

	if (first === -1 || last <= first) return stored;

	return stored.slice(first + "\n---\n".length, last);
}

export function diffArchiveMessages(
	incoming: string,
	storedOriginals: string[],
): {
	/** true = 输入是可指纹化的逐条格式，且确实发现了已入库消息。 */
	isIncremental: boolean;
	/** 喂给模型的新增正文（保留原有前导行 + 新增消息块）。 */
	newBody: string;
	storedCount: number;
	incomingCount: number;
	newCount: number;
} {
	const incomingSplit = splitMessageBlocks(incoming);
	if (!incomingSplit) {
		return { isIncremental: false, newBody: incoming, storedCount: 0, incomingCount: 1, newCount: 1 };
	}

	const known = new Set<string>();
	for (const stored of storedOriginals) {
		const split = splitMessageBlocks(stripIntakeWrapper(stored));
		if (!split) continue;

		for (const block of split.blocks) known.add(messageFingerprint(block));
	}

	const newBlocks = incomingSplit.blocks.filter((block) => !known.has(messageFingerprint(block)));
	const newBody = [incomingSplit.preamble, ...newBlocks].filter(Boolean).join("\n");

	return {
		isIncremental: true,
		newBody,
		storedCount: known.size,
		incomingCount: incomingSplit.blocks.length,
		newCount: newBlocks.length,
	};
}

/** 取一位联系人最近 N 次留底的原文（增量比对的索引源）。 */
export async function archiveOriginals(contactId: string, limit = 3): Promise<string[]> {
	const archives = await intakeArchives(contactId);
	const originals: string[] = [];

	for (const archive of archives.slice(0, limit)) {
		const [row] = await db()
			.select({ content: messages.content })
			.from(messages)
			.where(and(eq(messages.conversationId, archive.conversationId), eq(messages.role, "user")))
			.orderBy(asc(messages.createdAt))
			.limit(1);

		if (row?.content?.trim()) originals.push(row.content);
	}

	return originals;
}

/** 把一位联系人的聊天留底全部标为已看，返回这次实际标了几条（已看过的跳过）。 */
export async function markIntakeViewed(contactId: string): Promise<number> {
	const result = await db()
		.update(conversations)
		.set({ viewedAt: nowMs() })
		.where(
			and(
				eq(conversations.contactId, contactId),
				like(conversations.title, `${INTAKE_TITLE_PREFIX}%`),
				isNull(conversations.viewedAt),
			),
		);

	return result[0].affectedRows ?? 0;
}

/**
 * 最新一次留底的聊天原文（供「重新研究」附带重析）。
 *
 * 原文只存在 messages 里，普通研究读不到；这个入口让后台研究能对最近一次导入
 * 补做三层冰山分析，而不必从 MCP 把同样的记录再转发一遍。
 */
export async function latestArchiveOriginal(
	contactId: string,
): Promise<{ conversationId: string; title: string; text: string } | null> {
	const archives = await intakeArchives(contactId);
	if (archives.length === 0) return null;

	const latest = archives[0];
	const [row] = await db()
		.select({ content: messages.content })
		.from(messages)
		.where(and(eq(messages.conversationId, latest.conversationId), eq(messages.role, "user")))
		.orderBy(asc(messages.createdAt))
		.limit(1);

	const text = row?.content?.trim() ?? "";
	if (!text) return null;

	return { conversationId: latest.conversationId, title: latest.title, text };
}
