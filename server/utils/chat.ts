import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { ChatMessage, ChatToolCall, Conversation } from "../../app/types/domain";
import { conversations, messages } from "../db/schema";
import { db } from "./db";
import { newId, nowMs } from "./ids";
import { parseToolCalls } from "./parse";

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

function toConversation(row: ConversationRow): Conversation {
	return { ...row };
}

function toMessage(row: MessageRow): ChatMessage {
	return {
		...row,
		toolCalls: parseToolCalls(row.toolCalls),
	};
}

export async function listConversations(input: {
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
}): Promise<Conversation[]> {
	const filters = [];

	if (input.contactId) filters.push(eq(conversations.contactId, input.contactId));
	else if (input.companyId) filters.push(eq(conversations.companyId, input.companyId));
	else if (input.dealId) filters.push(eq(conversations.dealId, input.dealId));
	else
		filters.push(
			and(
				isNull(conversations.contactId),
				isNull(conversations.companyId),
				isNull(conversations.dealId),
			)!,
		);

	const rows = await db()
		.select()
		.from(conversations)
		.where(and(...filters))
		.orderBy(desc(conversations.lastMessageAt))
		.limit(50);

	return rows.map(toConversation);
}

export async function getConversation(id: string): Promise<Conversation | null> {
	const [row] = await db().select().from(conversations).where(eq(conversations.id, id)).limit(1);

	return row ? toConversation(row) : null;
}

export async function createConversation(input: {
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
	title: string;
}): Promise<Conversation> {
	const id = newId();
	const at = nowMs();

	await db().insert(conversations).values({
		id,
		contactId: input.contactId,
		companyId: input.companyId,
		dealId: input.dealId,
		title: input.title,
		createdAt: at,
		lastMessageAt: at,
	});

	const created = await getConversation(id);
	if (!created) throw new Error("会话创建失败。");

	return created;
}

export async function conversationMessages(
	conversationId: string,
	limit: number,
): Promise<ChatMessage[]> {
	const rows = await db()
		.select()
		.from(messages)
		.where(eq(messages.conversationId, conversationId))
		.orderBy(asc(messages.createdAt))
		.limit(limit);

	return rows.map(toMessage);
}

export async function appendMessage(input: {
	conversationId: string;
	role: "user" | "assistant";
	content: string;
	reasoning?: string | null;
	toolCalls?: ChatToolCall[] | null;
}): Promise<ChatMessage> {
	const id = newId();
	const at = nowMs();

	await db().insert(messages).values({
		id,
		conversationId: input.conversationId,
		role: input.role,
		content: input.content,
		reasoning: input.reasoning ?? null,
		toolCalls: input.toolCalls && input.toolCalls.length > 0 ? input.toolCalls : null,
		createdAt: at,
	});

	await db()
		.update(conversations)
		.set({ lastMessageAt: at })
		.where(eq(conversations.id, input.conversationId));

	const [row] = await db().select().from(messages).where(eq(messages.id, id)).limit(1);
	if (!row) throw new Error("消息写入失败。");

	return toMessage(row);
}

export async function deleteConversation(id: string): Promise<boolean> {
	const result = await db().delete(conversations).where(eq(conversations.id, id));

	return result[0].affectedRows > 0;
}
