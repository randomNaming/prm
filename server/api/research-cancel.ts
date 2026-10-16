import { z } from "zod";
import { guarded } from "../utils/guard";
import { cancelAgentTasks } from "../utils/queue";

const body = z.object({
	subject: z.enum(["contact", "company"]),
	id: z.string().trim().min(1).max(36),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const input = body.parse(await readBody(event));

		const cancelled = await cancelAgentTasks({
			targetType: input.subject,
			targetId: input.id,
		});

		return {
			ok: true,
			cancelled,
			reason:
				cancelled > 0
					? `已终止 ${cancelled} 项后台任务。`
					: "没有找到进行中的后台任务（可能刚刚自己跑完了）。",
		};
	}),
);
