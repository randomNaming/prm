import { z } from "zod";
import { completeActivity, reopenActivity } from "../utils/activities";
import { guarded, notFound } from "../utils/guard";

const body = z.object({
	id: z.string().trim().min(1).max(36),
	action: z.enum(["complete", "reopen"]),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const input = body.parse(await readBody(event));

		const ok =
			input.action === "complete"
				? await completeActivity(input.id)
				: await reopenActivity(input.id);

		if (!ok) throw notFound("任务不存在或已经处理过了。");

		return { ok: true, action: input.action };
	}),
);
