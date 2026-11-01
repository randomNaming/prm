import { createError, getRequestURL, sendRedirect } from "h3";
import { megrezEnabled, readSession } from "../utils/megrez";

/**
 * 天权 SSO 的入口拦截。
 *
 * 规则：
 * - 未配置天权（MEGREZ_* 为空）→ 完全不启用，与接入前行为一致，本地开发不受影响；
 * - /api/* 未登录 → 401（前端据此提示或跳登录）；
 * - 页面未登录 → 302 到 /auth/login，回跳时带回原路径。
 *
 * 只做本地验签，不回调天权，天权挂了已登录的会话照常可用。
 */
const PUBLIC_PREFIXES = [
	"/_nuxt/",
	"/__nuxt",
	"/@vite",
	"/@id",
	"/auth/login",
	"/auth/callback",
	"/auth/logout",
	"/api/health",
];

const PUBLIC_EXACT = new Set(["/favicon.ico", "/robots.txt"]);

export default defineEventHandler(async (event) => {
	if (!megrezEnabled()) return;

	const pathname = getRequestURL(event).pathname;

	if (PUBLIC_EXACT.has(pathname)) return;
	if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return;

	const claims = await readSession(event);
	if (claims) {
		event.context.session = claims;

		return;
	}

	if (pathname.startsWith("/api/")) {
		throw createError({ statusCode: 401, statusMessage: "未登录：请先通过天权登录。" });
	}

	if (event.method !== "GET") {
		throw createError({ statusCode: 401, statusMessage: "未登录：请先通过天权登录。" });
	}

	const next = event.path || "/";

	return sendRedirect(event, `/auth/login?redirect=${encodeURIComponent(next)}`, 302);
});
