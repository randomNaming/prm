import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type StubToolCall = {
	name: string;
	args: Record<string, unknown>;
};

export type StubTurn = {
	reasoning?: string;
	content?: string;
	toolCalls?: StubToolCall[];
	status?: number;
};

export type StubRequest = {
	stream: boolean;
	messageCount: number;
	tools: string[];
	messages: unknown[];
};

export type StubModel = {
	baseUrl: string;
	requests: StubRequest[];
	close: () => Promise<void>;
};

export type StubPlanner = (input: { messages: unknown[]; index: number }) => StubTurn;

function chunk(payload: Record<string, unknown>) {
	return `data: ${JSON.stringify({
		id: "chatcmpl-stub",
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: "glm-test",
		...payload,
	})}\n\n`;
}

function toolCallPayload(turn: StubTurn) {
	return (turn.toolCalls ?? []).map((call, index) => ({
		index,
		id: `call_${index}`,
		type: "function",
		function: { name: call.name, arguments: JSON.stringify(call.args) },
	}));
}

export async function startStubModel(turns: StubTurn[] | StubPlanner): Promise<StubModel> {
	const requests: StubRequest[] = [];
	let index = 0;

	const plan: StubPlanner = Array.isArray(turns)
		? () => turns[Math.min(index - 1, turns.length - 1)] ?? { content: "" }
		: turns;

	const server = createServer((request, response) => {
		let raw = "";

		request.on("data", (part) => {
			raw += part;
		});

		request.on("end", () => {
			const body = JSON.parse(raw || "{}") as {
				stream?: boolean;
				messages?: unknown[];
				tools?: { function?: { name?: string } }[];
			};

			const current = index;
			index += 1;

			const turn = plan({ messages: body.messages ?? [], index: current });

			requests.push({
				stream: Boolean(body.stream),
				messageCount: body.messages?.length ?? 0,
				tools: (body.tools ?? []).map((item) => item.function?.name ?? ""),
				messages: body.messages ?? [],
			});

			if (turn.status && turn.status >= 400) {
				response.writeHead(turn.status, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: "stub 提供的失败响应" } }));

				return;
			}

			if (!body.stream) {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						id: "chatcmpl-stub",
						object: "chat.completion",
						created: Math.floor(Date.now() / 1000),
						model: "glm-test",
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: turn.content ?? "",
									reasoning_content: turn.reasoning ?? null,
									tool_calls: turn.toolCalls ? toolCallPayload(turn) : null,
								},
								finish_reason: turn.toolCalls ? "tool_calls" : "stop",
							},
						],
						usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
					}),
				);

				return;
			}

			response.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
			});

			if (turn.reasoning) {
				response.write(chunk({ choices: [{ index: 0, delta: { role: "assistant", reasoning_content: turn.reasoning }, finish_reason: null }] }));
			}

			if (turn.toolCalls) {
				response.write(chunk({ choices: [{ index: 0, delta: { tool_calls: toolCallPayload(turn) }, finish_reason: null }] }));
				response.write(
					chunk({
						choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
						usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
					}),
				);
			} else {
				if (turn.content) {
					response.write(chunk({ choices: [{ index: 0, delta: { content: turn.content }, finish_reason: null }] }));
				}
				response.write(
					chunk({
						choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
						usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
					}),
				);
			}

			response.write("data: [DONE]\n\n");
			response.end();
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	const address = server.address() as AddressInfo;

	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		requests,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
			}),
	};
}
