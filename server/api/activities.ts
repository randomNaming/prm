import { z } from "zod";
import { READONLY_ACTIVITY_KINDS } from "../../app/types/domain";
import { activityInput, listQuery } from "../utils/validate";
import { createActivity, listActivities } from "../utils/activities";
import { badRequest, guarded } from "../utils/guard";

const query = listQuery.extend({
	contactId: z.string().trim().max(36).optional(),
	companyId: z.string().trim().max(36).optional(),
	dealId: z.string().trim().max(36).optional(),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method === "POST") {
			const input = activityInput.parse(await readBody(event));

			// stage_change 与 chat_log 是服务端自己写的只读留底，
			// 不接受客户端伪造 —— 否则「只读」就只是界面上的约定。
			if (READONLY_ACTIVITY_KINDS.includes(input.kind)) {
				throw badRequest(`「${input.kind}」类型的活动由系统写入，不能手工创建。`);
			}

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
