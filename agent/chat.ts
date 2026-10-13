import { stepCountIs, streamText, type ModelMessage } from "ai";
import type { ChatToolCall } from "../app/types/domain";
import {
	appendMessage,
	conversationMessages,
	createConversation,
	getConversation,
} from "../server/utils/chat";
import { CONFIG } from "../server/utils/config";
import { AgentDisabledError, agentModel } from "./model";
import {
	CHAT_SYSTEM,
	companyContext,
	companyPreamble,
	contactContext,
	contactPreamble,
	dealContext,
	dealPreamble,
} from "./prompts";
import { crmTools } from "./tools";

export type RecordFocus = {
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
};

export type ChatEvent =
	| { type: "start"; conversationId: string }
	| { type: "reasoning"; text: string }
	| { type: "text"; text: string }
	| { type: "tool"; name: string; input: unknown }
	| { type: "tool_result"; name: string; result: unknown }
	| { type: "done"; conversationId: string; messageId: string; tokens: number | null }
	| { type: "error"; message: string };

function titleFrom(message: string): string {
	const trimmed = message.trim().replace(/\s+/g, " ");

	return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed;
}

export async function resolveConversation(input: {
	conversationId: string | null;
	focus: RecordFocus;
	message: string;
}) {
	if (input.conversationId) {
		const existing = await getConversation(input.conversationId);
		if (existing) return existing;
	}

	return createConversation({
		contactId: input.focus.contactId,
		companyId: input.focus.companyId,
		dealId: input.focus.dealId,
		title: titleFrom(input.message),
	});
}

export async function systemPromptFor(focus: RecordFocus): Promise<string> {
	if (focus.contactId) {
		const context = await contactContext(focus.contactId);
		if (context) {
			return [CHAT_SYSTEM, contactPreamble(context)].join("\n\n");
		}
	}

	if (focus.companyId) {
		const context = await companyContext(focus.companyId);
		if (context) {
			return [CHAT_SYSTEM, companyPreamble(context)].join("\n\n");
		}
	}

	if (focus.dealId) {
		const context = await dealContext(focus.dealId);
		if (context) {
			return [CHAT_SYSTEM, dealPreamble(context)].join("\n\n");
		}
	}

	return CHAT_SYSTEM;
}

export async function* chatStream(input: {
	conversationId: string;
	focus: RecordFocus;
	message: string;
	/** 覆盖默认系统提示。微信导入路径传 WECHAT_SYSTEM。 */
	systemOverride?: string;
}): AsyncGenerator<ChatEvent> {
	yield { type: "start", conversationId: input.conversationId };

	await appendMessage({
		conversationId: input.conversationId,
		role: "user",
		content: input.message,
	});

	const stored = await conversationMessages(input.conversationId, CONFIG.agent.historyMessages);
	const history: ModelMessage[] = stored
		.filter((message) => (message.content ?? "").trim().length > 0)
		.map((message) => ({
			role: message.role === "user" ? ("user" as const) : ("assistant" as const),
			content: message.content ?? "",
		}));

	let text = "";
	let reasoning = "";
	const toolCalls: ChatToolCall[] = [];
	let tokens: number | null = null;

	try {
		const system = input.systemOverride ?? (await systemPromptFor(input.focus));
		const result = streamText({
			model: agentModel(),
			system,
			messages: history,
			tools: crmTools(),
			stopWhen: stepCountIs(CONFIG.agent.maxSteps),
			maxOutputTokens: CONFIG.agent.maxOutputTokens,
			maxRetries: CONFIG.agent.maxRetries,
		});

		for await (const part of result.fullStream) {
			switch (part.type) {
				case "reasoning-delta": {
					reasoning += part.text;
					yield { type: "reasoning", text: part.text };
					break;
				}
				case "text-delta": {
					text += part.text;
					yield { type: "text", text: part.text };
					break;
				}
				case "tool-call": {
					toolCalls.push({ name: part.toolName, input: part.input, result: null });
					yield { type: "tool", name: part.toolName, input: part.input };
					break;
				}
				case "tool-result": {
					const call = toolCalls.find(
						(item) => item.name === part.toolName && item.result === null,
					);
					if (call) call.result = part.output;
					yield { type: "tool_result", name: part.toolName, result: part.output };
					break;
				}
				case "finish": {
					tokens = part.totalUsage?.totalTokens ?? null;
					break;
				}
				case "error": {
					yield { type: "error", message: describeError(part.error) };
					break;
				}
				default:
					break;
			}
		}
	} catch (error) {
		yield { type: "error", message: describeError(error) };

		if (error instanceof AgentDisabledError) {
			yield { type: "done", conversationId: input.conversationId, messageId: "", tokens: null };
			return;
		}
	}

	const assistant = await appendMessage({
		conversationId: input.conversationId,
		role: "assistant",
		content: text,
		reasoning,
		toolCalls,
	});

	yield {
		type: "done",
		conversationId: input.conversationId,
		messageId: assistant.id,
		tokens,
	};
}

export function describeError(error: unknown): string {
	if (error instanceof AgentDisabledError) return error.message;
	if (error instanceof Error) return `智能体调用失败：${error.message}`;

	return "智能体调用失败：未知错误。";
}
