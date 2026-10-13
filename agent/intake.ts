import { appendMessage, attachConversation, createConversation, conversationMessages } from "../server/utils/chat";
import { createActivity } from "../server/utils/activities";
import { getContact } from "../server/utils/contacts";
import { CONFIG } from "../server/utils/config";
import { digestIntakeText, intakeTitle } from "../server/utils/intake-archive";
import type { ChatToolCall } from "../app/types/domain";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { AgentDisabledError, agentModel } from "./model";
import { WECHAT_SYSTEM } from "./prompts";
import { crmTools } from "./tools";

export type IntakeInput = {
	/** 会话对方昵称，来自 MCP 的 person。 */
	person: string;
	/** 来源文件名，写进 evidence.ref。 */
	file: string | null;
	/** 聊天记录原文，逐字转发，不做加工。 */
	text: string;
};

export type IntakeToolCall = {
	name: string;
	input: unknown;
	result: unknown;
};

export type IntakeResult = {
	conversationId: string;
	messageId: string;
	/** 这一轮落到哪位联系人身上。没认出来时为 null，会话也就挂不到人。 */
	contactId: string | null;
	summary: string;
	toolCalls: IntakeToolCall[];
	/** 各工具调用次数，方便验收时一眼看清建了什么。 */
	counts: Record<string, number>;
	created: {
		contacts: { id: string; name: string }[];
		companies: { id: string; name: string }[];
	};
	tokens: number | null;
};

/**
 * 这一轮导入最终归到谁名下。
 *
 * ensure_contact 无论新建还是命中既有记录都会回 id，两种都算数 ——
 * 二次导入同一个人时命中的是既有记录，此时更要把留底挂上去。
 * 优先取新建的那条，避免一次导入里认了多个人时挂错。
 */
export function pickContactId(toolCalls: IntakeToolCall[]): string | null {
	const created: string[] = [];
	const matched: string[] = [];

	for (const call of toolCalls) {
		if (call.name !== "ensure_contact") continue;

		const payload = call.result as Record<string, unknown> | null;
		const id = payload && typeof payload.id === "string" ? payload.id : null;
		if (!id) continue;

		(payload?.created === true ? created : matched).push(id);
	}

	return created[0] ?? matched[0] ?? null;
}

function describeError(error: unknown): string {
	if (error instanceof AgentDisabledError) return error.message;
	if (error instanceof Error) return `智能体调用失败：${error.message}`;

	return "智能体调用失败：未知错误。";
}

/**
 * 把一段微信聊天记录组装成 Agent 可读的文本。
 * 头部携带昵称与来源文件名——这两项正是 evidence.ref 需要的。
 */
export function buildIntakeMessage(input: IntakeInput): string {
	const file = input.file?.trim() || "（未提供文件名）";
	const header = `【微信聊天记录】对方昵称：${input.person}；来源文件：${file}`;
	const trailer = `以上为该会话的全部聊天原文，未做任何加工。请按规则抽取联系人与公司信息并写入 CRM。`;

	return [header, "---", input.text.trim(), "---", trailer].join("\n");
}

/**
 * 非流式跑一轮微信导入。MCP Server 只转发文本，加工全部发生在这里。
 */
export async function runIntake(input: IntakeInput): Promise<IntakeResult> {
	const message = buildIntakeMessage(input);

	const conversation = await createConversation({
		contactId: null,
		companyId: null,
		dealId: null,
		title: `微信记录导入：${input.person}`.slice(0, 30),
	});

	await appendMessage({
		conversationId: conversation.id,
		role: "user",
		content: message,
	});

	const stored = await conversationMessages(conversation.id, CONFIG.agent.historyMessages);
	const history: ModelMessage[] = stored
		.filter((item) => (item.content ?? "").trim().length > 0)
		.map((item) => ({
			role: item.role === "user" ? ("user" as const) : ("assistant" as const),
			content: item.content ?? "",
		}));

	const result = await generateText({
		model: agentModel(),
		system: WECHAT_SYSTEM,
		messages: history,
		tools: crmTools(),
		stopWhen: stepCountIs(CONFIG.agent.maxSteps),
		maxOutputTokens: CONFIG.agent.maxOutputTokens,
		maxRetries: CONFIG.agent.maxRetries,
	});

	const toolCalls: IntakeToolCall[] = result.steps
		.flatMap((step) => step.toolCalls ?? [])
		.map((call) => ({ name: call.toolName, input: call.input, result: null }));

	const outputs = result.steps.flatMap((step) => step.toolResults ?? []);
	for (const output of outputs) {
		const target = toolCalls.find((call) => call.name === output.toolName && call.result === null);
		if (target) target.result = output.output;
	}

	const counts: Record<string, number> = {};
	for (const call of toolCalls) {
		counts[call.name] = (counts[call.name] ?? 0) + 1;
	}

	const created: IntakeResult["created"] = { contacts: [], companies: [] };

	for (const call of toolCalls) {
		const payload = call.result as Record<string, unknown> | null;
		if (!payload || payload.created !== true) continue;

		if (call.name === "ensure_contact") {
			created.contacts.push({ id: String(payload.id), name: String(payload.name) });
		}

		if (call.name === "ensure_company") {
			created.companies.push({ id: String(payload.id), name: String(payload.name) });
		}
	}

	const summary = result.text.trim();

	// 空结果防护：既没有正文、也没有任何工具调用，说明这一轮实际没跑成
	// （典型原因：输出 token 上限被截断）。此时必须显式报错，绝不静默存一条空
	// assistant 消息——否则使用者只会看到「没有任何新增」而无从排查。
	if (!summary && toolCalls.length === 0) {
		throw new Error(
			`智能体本轮没有产生任何输出（finishReason=${result.finishReason}）。` +
				`已消耗输出 token ${result.totalUsage?.outputTokens ?? 0}，` +
				`请检查 CONFIG.agent.maxOutputTokens 是否过小，或模型服务是否异常。`,
		);
	}

	const assistant = await appendMessage({
		conversationId: conversation.id,
		role: "assistant",
		content: summary,
		reasoning: "",
		toolCalls: toolCalls.map(
			(call): ChatToolCall => ({ name: call.name, input: call.input, result: call.result }),
		),
	});

	// 留底：把会话挂到人身上，标题带上「多少条 + 覆盖区间」。
	// 会话是在抽取之前建的，那时还不知道是谁，所以只能在这里回填。
	const digest = digestIntakeText(input.text);
	const title = intakeTitle(input.person, digest);
	const contactId = pickContactId(toolCalls);
	const contact = contactId ? await getContact(contactId) : null;
	const companyId = contact?.companyId ?? null;

	await attachConversation({ conversationId: conversation.id, contactId, companyId, title });

	// 时间线上的锚点由服务端确定性地写，不交给模型：漏写就没有入口，
	// 而且「来源文件、条数、覆盖区间」这些元信息不该由模型转述。
	if (contactId) {
		await createActivity({
			kind: "chat_log",
			title,
			body: summary || null,
			contactId,
			companyId,
			dealId: null,
			dueAt: null,
		});
	}

	return {
		conversationId: conversation.id,
		messageId: assistant.id,
		contactId,
		summary,
		toolCalls,
		counts,
		created,
		tokens: result.totalUsage?.totalTokens ?? null,
	};
}

export { describeError as describeIntakeError };
