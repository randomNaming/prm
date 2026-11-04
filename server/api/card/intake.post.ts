import { z } from "zod";
import { CONFIG } from "../../utils/config";
import { intakeCard } from "../../utils/cards";
import { guarded } from "../../utils/guard";
import { readSession } from "../../utils/megrez";

const intakeInput = z.object({
	// 1-2 张，一次综合识别（正面 + 背面/补充信息），不是分两次识别。
	images: z.array(z.string()).min(1, "缺少图片").max(CONFIG.card.maxImages),
	text: z.string().trim().max(CONFIG.card.maxHintTextChars).nullish(),
	locale: z.string().trim().max(16).nullish(),
});

/**
 * 名片识图：收图并识别。
 * 图片只在请求内存里流转（解码 → 交给视觉模型 → 释放），服务器不落盘、不进库，
 * 只保留 image_hash 与 image_bytes 两个数字。
 */
export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method !== "POST") {
			throw createError({ statusCode: 405, statusMessage: "该端点只接受 POST 请求。" });
		}

		const parsed = intakeInput.safeParse(await readBody(event));
		if (!parsed.success) {
			throw createError({
				statusCode: 400,
				statusMessage: "参数不对：images 必填（1-2 张 data URL 图片）。",
				data: { code: "bad_request" },
			});
		}

		// 设备身份来自天权票据的 sub（dev_xxx）；天权未启用时本地开发记为 local。
		const claims = await readSession(event);

		return intakeCard({
			deviceId: claims?.sub ?? "local",
			images: parsed.data.images,
			text: parsed.data.text ?? null,
			locale: parsed.data.locale ?? null,
		});
	}),
);
