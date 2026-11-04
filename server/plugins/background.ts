import { ensureAutoMigrations } from "../utils/auto-migrate";
import { databaseConfigured } from "../utils/db";
import { seedBuiltinFields } from "../utils/fields";
import { startQueueWorker } from "../utils/worker";

export default defineNitroPlugin(() => {
	if (import.meta.prerender) return;

	const state = globalThis as typeof globalThis & { __crmQueueWorker?: boolean };
	if (state.__crmQueueWorker) return;

	state.__crmQueueWorker = true;

	// 等启动迁移结束再种子字段、启动队列：新库第一次启动时表可能还没建好。
	void ensureAutoMigrations()
		.then(async () => {
			if (!databaseConfigured()) {
				console.warn("[crm] DATABASE_URL 未配置：字段表未种子，后台研究队列未启动。");

				return;
			}

			const count = await seedBuiltinFields();
			console.info(`[crm] 字段表已就绪（${count} 个内置字段）。`);

			startQueueWorker();
			console.info("[crm] 后台研究队列已启动，每分钟认领到期任务。");
		})
		.catch((error: unknown) => {
			console.error("[crm] 启动初始化失败：", error);
		});
});
