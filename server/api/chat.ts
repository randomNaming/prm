import { chatInput } from "../utils/validate";
import { chatStream, describeError, resolveConversation } from "../../agent/chat";
import { agentCapability } from "../utils/env";
import { guarded } from "../utils/guard";

export default defineEventHandler((event) =>
	guarded(async () => {
		const input = chatInput.parse(await readBody(event));
		const focus = {
			contactId: input.contactId ?? null,
			companyId: input.companyId ?? null,
			dealId: input.dealId ?? null,
		};

		if (!agentCapability().enabled) {
			return {
				disabled: true,
				reason: agentCapability().reason,
			};
		}

		const conversation = await resolveConversation({
			conversationId: input.conversationId ?? null,
			focus,
			message: input.message,
		});

		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				const send = (payload: unknown) => {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
				};

				try {
					for await (const chunk of chatStream({
						conversationId: conversation.id,
						focus,
						message: input.message,
					})) {
						send(chunk);
					}
				} catch (error) {
					send({ type: "error", message: describeError(error) });
				} finally {
					controller.close();
				}
			},
		});

		setResponseHeaders(event, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
		});

		return body;
	}),
);
