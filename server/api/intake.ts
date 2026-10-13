import { z } from "zod";
import { runIntake, describeIntakeError } from "../../agent/intake";
import { CONFIG } from "../utils/config";
import { agentCapability } from "../utils/env";
import { guarded } from "../utils/guard";

const intakeInput = z.object({
	person: z.string().trim().min(1, "缺少会话昵称").max(64),
	file: z.string().trim().max(CONFIG.text.maxFieldLength).nullish(),
	text: z.string().trim().min(1, "聊天记录不能为空").max(CONFIG.intake.maxTextLength),
});

/**
 * 微信聊天记录导入端点。
 * MCP Server（mcp-crm）只负责转发原文，抽取、建档、写字段全部在这里完成。
 */
export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method !== "POST") {
			throw createError({ statusCode: 405, statusMessage: "该端点只接受 POST 请求。" });
		}

		const input = intakeInput.parse(await readBody(event));

		const capability = agentCapability();
		if (!capability.enabled) {
			return {
				ok: false,
				disabled: true,
				reason: capability.reason,
			};
		}

		try {
			const result = await runIntake({
				person: input.person,
				file: input.file ?? null,
				text: input.text,
			});

			return { ok: true, ...result };
		} catch (error) {
			return {
				ok: false,
				reason: describeIntakeError(error),
			};
		}
	}),
);
