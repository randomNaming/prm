/**
 * 名片识图模型自检：验证 VISION_MODEL 是否支持 image_url 图片输入（需求 v1.1 §十二）。
 *
 * 用法：在 .env 里配好 VISION_BASE_URL / VISION_API_KEY / VISION_MODEL 后执行
 *   bun scripts/vision-smoke.ts
 * 发送一张 1×1 PNG + 一句固定提问，成功打印支持结论；失败打印原因与换型建议。
 * 只做连通性验证，不验识别质量。图片以 base64 内嵌，不产生任何文件。
 */
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { generateText } from "ai";
import { visionModel } from "../agent/model";
import { visionCapability } from "../server/utils/env";

loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

const ONE_BY_ONE_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==",
	"base64",
);

async function main(): Promise<void> {
	const capability = visionCapability();

	if (!capability.enabled) {
		console.error(`✗ 视觉模型未配置：${capability.reason}`);
		console.error("  请在 .env 里填写 VISION_API_KEY（可复用聊天的 key）。");

		return;
	}

	console.log(`→ 端点 ${capability.baseUrl}　模型 ${capability.model}`);

	try {
		const result = await generateText({
			model: visionModel(),
			system: "你是连通性探针。看到图片后只回复两个字：正常。",
			messages: [
				{
					role: "user",
					content: [
						{ type: "file", data: ONE_BY_ONE_PNG, mediaType: "image/png" },
						{ type: "text", text: "这张图能看见吗？" },
					],
				},
			],
			maxRetries: 0,
		});

		console.log(`✓ 模型接受 image_url 图片输入，回复：${result.text.trim().slice(0, 80) || "(空)"}`);
		console.log(`  结论：${capability.model} 可用于名片识图。`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		console.error(`✗ 失败：${message.slice(0, 300)}`);
		console.error("  结论：该模型可能不支持图片输入。换一个支持多模态的模型名");
		console.error("  （改 .env 的 VISION_MODEL 即可，key 可继续复用），再跑一次本脚本。");

		process.exitCode = 1;
	}
}

await main();
