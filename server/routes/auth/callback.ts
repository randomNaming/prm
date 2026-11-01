import { createError, deleteCookie, getCookie, getQuery, sendRedirect, setCookie } from "h3";
import { NEXT_COOKIE, SESSION_COOKIE, STATE_COOKIE, cookieOptions, megrezConfig, megrezEnabled } from "../../utils/megrez";

/**
 * 天权回调：核对 state → 服务端到服务端换票 → 写自己的 HttpOnly Cookie → 回原页面。
 * client_secret 只在这里用，永远不下发浏览器。
 */
export default defineEventHandler(async (event) => {
	if (!megrezEnabled()) {
		throw createError({ statusCode: 503, statusMessage: "天权未配置。" });
	}

	const config = megrezConfig();
	const query = getQuery(event);
	const expectedState = getCookie(event, STATE_COOKIE);
	const next = getCookie(event, NEXT_COOKIE) || "/";

	deleteCookie(event, STATE_COOKIE, { path: "/" });
	deleteCookie(event, NEXT_COOKIE, { path: "/" });

	if (!expectedState || typeof query.state !== "string" || query.state !== expectedState) {
		throw createError({ statusCode: 400, statusMessage: "登录状态校验失败，请重新发起登录。" });
	}

	if (typeof query.error === "string") {
		throw createError({ statusCode: 403, statusMessage: "你在天权取消了本次授权。" });
	}

	if (typeof query.code !== "string" || !query.code) {
		throw createError({ statusCode: 400, statusMessage: "回调缺少授权码。" });
	}

	let payload: { access_token?: string; expires_in?: number };

	try {
		payload = await $fetch<{ access_token?: string; expires_in?: number }>(`${config.base}/oauth/token`, {
			method: "POST",
			body: {
				grant_type: "authorization_code",
				code: query.code,
				client_id: config.clientId,
				client_secret: config.clientSecret,
			},
		});
	} catch {
		throw createError({ statusCode: 502, statusMessage: "向天权换取票据失败，请稍后重试。" });
	}

	if (!payload?.access_token) {
		throw createError({ statusCode: 502, statusMessage: "天权没有返回访问票据。" });
	}

	const maxAge = Number.isFinite(payload.expires_in) && payload.expires_in! > 0 ? payload.expires_in! : 8 * 3600;

	setCookie(event, SESSION_COOKIE, payload.access_token, cookieOptions(event, maxAge));

	const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";

	return sendRedirect(event, target, 302);
});
