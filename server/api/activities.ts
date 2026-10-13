import { z } from "zod";
import { activityInput, listQuery } from "../utils/validate";
import { createActivity, listActivities } from "../utils/activities";
import { guarded } from "../utils/guard";

const query = listQuery.extend({
	contactId: z.string().trim().max(36).optional(),
	companyId: z.string().trim().max(36).optional(),
	dealId: z.string().trim().max(36).optional(),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method === "POST") {
			const input = activityInput.parse(await readBody(event));

			return { activity: await createActivity(input) };
		}

		const parsed = query.parse(getQuery(event));

		return listActivities({
			contactId: parsed.contactId ?? null,
			companyId: parsed.companyId ?? null,
			dealId: parsed.dealId ?? null,
			limit: parsed.pageSize,
			page: parsed.page,
		});
	}),
);
