import { createError } from "h3";
import { ensureAutoMigrations } from "../utils/auto-migrate";

/**
 * 启动迁移闸门。
 *
 * 迁移在 server/plugins/00-auto-migrate.ts 里随进程启动；这里 await 同一个 Promise：
 * 迁移完成前所有请求等待；迁移失败则统一 503，避免新代码带着缺表/缺列的结构对外服务。
 *
 * 关闭方式：PRM_AUTO_MIGRATE=off（紧急回滚时可用），或根本不配置 PRM_MIGRATE_URL。
 */
export default defineEventHandler(async () => {
	try {
		await ensureAutoMigrations();
	} catch {
		throw createError({
			statusCode: 503,
			statusMessage: "数据库迁移失败，服务暂不可用。",
		});
	}
});
