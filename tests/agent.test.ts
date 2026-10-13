import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chatStream, systemPromptFor, type ChatEvent } from "../agent/chat";
import { conversationMessages, createConversation } from "../server/utils/chat";
import { closeDb } from "../server/utils/db";
import { contactFixture, resetDatabase, useAgentEnv } from "./helpers";
import { startStubModel, type StubModel } from "./stub-model";

let stub: StubModel | null = null;

beforeEach(async () => {
	await resetDatabase();
});

afterEach(async () => {
	if (stub) {
		await stub.close();
		stub = null;
	}
});

afterAll(async () => {
	await closeDb();
});

async function collect(stream: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
	const events: ChatEvent[] = [];

	for await (const event of stream) events.push(event);

	return events;
}

function textOf(events: ChatEvent[]): string {
	return events
		.filter((event): event is { type: "text"; text: string } => event.type === "text")
		.map((event) => event.text)
		.join("");
}

describe("FR-4 智能体对话", () => {
	test("流式输出正文与思考过程，工具调用真实执行，消息落库", async () => {
		const contact = await contactFixture({ title: "产品经理" });
		stub = await startStubModel([
			{
				reasoning: "先读这位联系人。",
				toolCalls: [{ name: "read_contact", args: { contact_id: contact.id } }],
			},
			{ reasoning: "库里说得很清楚。", content: "他叫王小明，职位是产品经理。" },
		]);
		useAgentEnv(stub.baseUrl);

		const conversation = await createConversation({
			contactId: contact.id,
			companyId: null,
			dealId: null,
			title: "这个联系人是谁",
		});

		const events = await collect(
			chatStream({
				conversationId: conversation.id,
				focus: { contactId: contact.id, companyId: null, dealId: null },
				message: "这个联系人是谁",
			}),
		);

		expect(events[0]).toEqual({ type: "start", conversationId: conversation.id });
		expect(textOf(events)).toContain("王小明");
		expect(
			events
				.filter((event): event is { type: "reasoning"; text: string } => event.type === "reasoning")
				.map((event) => event.text)
				.join(""),
		).toContain("先读这位联系人");
		expect(events.some((event) => event.type === "tool" && event.name === "read_contact")).toBe(true);
		expect(events.some((event) => event.type === "tool_result" && event.name === "read_contact")).toBe(true);

		const done = events.at(-1);
		expect(done?.type).toBe("done");

		const messages = await conversationMessages(conversation.id, 10);
		expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(messages[1].content).toContain("王小明");
		expect(messages[1].reasoning).toContain("库里说得很清楚");
		expect(messages[1].toolCalls?.[0]?.name).toBe("read_contact");
	});

	test("同一会话第二轮带上历史上下文", async () => {
		const contact = await contactFixture();
		stub = await startStubModel([{ content: "第一次回答。" }, { content: "第二次回答。" }]);
		useAgentEnv(stub.baseUrl);

		const conversation = await createConversation({
			contactId: contact.id,
			companyId: null,
			dealId: null,
			title: "第一轮",
		});
		const focus = { contactId: contact.id, companyId: null, dealId: null };

		await collect(chatStream({ conversationId: conversation.id, focus, message: "第一轮问题" }));
		await collect(chatStream({ conversationId: conversation.id, focus, message: "第二轮问题" }));

		const messages = await conversationMessages(conversation.id, 10);
		expect(messages).toHaveLength(4);
		expect(stub.requests).toHaveLength(2);
		expect(stub.requests[1].messageCount).toBeGreaterThan(stub.requests[0].messageCount);
	});

	test("未配置密钥：对话禁用并明示原因，不抛错", async () => {
		delete process.env.ZAI_API_KEY;

		const contact = await contactFixture();
		const conversation = await createConversation({
			contactId: contact.id,
			companyId: null,
			dealId: null,
			title: "禁用",
		});

		const events = await collect(
			chatStream({
				conversationId: conversation.id,
				focus: { contactId: contact.id, companyId: null, dealId: null },
				message: "在吗",
			}),
		);

		const error = events.find((event) => event.type === "error");
		expect(error?.type).toBe("error");
		expect(error && "message" in error ? error.message : "").toContain("ZAI_API_KEY");

		const messages = await conversationMessages(conversation.id, 10);
		expect(messages.map((message) => message.role)).toEqual(["user"]);
	});

	test("单轮工具步数不超过 8 步，超限优雅终止", async () => {
		const contact = await contactFixture();
		stub = await startStubModel([
			{
				reasoning: "继续读。",
				toolCalls: [{ name: "read_contact", args: { contact_id: contact.id } }],
			},
		]);
		useAgentEnv(stub.baseUrl);

		const conversation = await createConversation({
			contactId: contact.id,
			companyId: null,
			dealId: null,
			title: "步数",
		});

		const events = await collect(
			chatStream({
				conversationId: conversation.id,
				focus: { contactId: contact.id, companyId: null, dealId: null },
				message: "一直读",
			}),
		);

		expect(stub.requests.length).toBeLessThanOrEqual(8);
		expect(stub.requests.length).toBeGreaterThan(1);
		expect(events.at(-1)?.type).toBe("done");
		expect(events.some((event) => event.type === "error")).toBe(false);
	});

	test("系统提示词声明数据边界：只有 CRM 数据、没有微信、无证据要直说", async () => {
		const contact = await contactFixture();
		const prompt = await systemPromptFor({ contactId: contact.id, companyId: null, dealId: null });

		expect(prompt).toContain("没有微信聊天数据");
		expect(prompt).toContain("无证据");
		expect(prompt).toContain("record_fact");
	});
});
