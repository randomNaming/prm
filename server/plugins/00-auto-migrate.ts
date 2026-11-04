import { ensureAutoMigrations } from "../utils/auto-migrate";

/**
 * 进程启动即开始检查迁移，而不是等第一个请求。
 *
 * Nitro 的 plugin 不会被 await，所以这里只负责「点火」：
 * 迁移本身在后台跑，请求侧的中间件会 await 同一个 Promise，
 * 迁移没完成之前不会有请求被处理。
 *
 * 这样 `systemctl restart prm` 之后立刻就能在 journal 里看到 [migrate] 日志，
 * 不用先访问一次页面才触发。
 */
export default defineNitroPlugin(() => {
	void ensureAutoMigrations().catch((error) => {
		// 错误同时会被请求中间件接住并返回 503；这里只负责把日志打出来。
		console.error("[migrate] 启动自动迁移失败：", error);
	});
});
