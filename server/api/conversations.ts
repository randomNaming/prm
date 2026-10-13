import { z } from "zod";
import { conversationQuery } from "../utils/validate";
import { conversationMessages, listConversations } from "../utils/chat";
import { guarded } from "../utils/guard";

const query = conversationQuery.extend({
	conversationId: z.string().trim().max(36).optional(),
	limit: z.coerce.number().int().min(1).max(200).optional(),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const parsed = query.parse(getQuery(event));

		if (parsed.conversationId) {
			return {
				messages: await conversationMessages(parsed.conversationId, parsed.limit ?? 100),
			};
		}

		return {
			conversations: await listConversations({
				contactId: parsed.contactId ?? null,
				companyId: parsed.companyId ?? null,
				dealId: parsed.dealId ?? null,
			}),
		};
	}),
);
