import { databaseConfigured } from "../utils/db";
import { seedBuiltinFields } from "../utils/fields";
import { startQueueWorker } from "../utils/worker";

export default defineNitroPlugin(() => {
	if (import.meta.prerender) return;

	const state = globalThis as typeof globalThis & { __crmQueueWorker?: boolean };
	if (state.__crmQueueWorker) return;

	state.__crmQueueWorker = true;

	if (!databaseConfigured()) {
		console.warn("[crm] DATABASE_URL 未配置：字段表未种子，后台研究队列未启动。");

		return;
	}

	void seedBuiltinFields()
		.then((count) => console.info(`[crm] 字段表已就绪（${count} 个内置字段）。`))
		.catch((error: unknown) => console.error("[crm] 字段表种子失败：", error));

	startQueueWorker();
	console.info("[crm] 后台研究队列已启动，每分钟认领到期任务。");
});
