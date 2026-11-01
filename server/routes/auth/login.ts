import { randomUUID } from "node:crypto";
import { createError, getQuery, sendRedirect, setCookie } from "h3";
import { NEXT_COOKIE, STATE_COOKIE, cookieOptions, megrezConfig, megrezEnabled } from "../../utils/megrez";

/**
 * 发起 SSO：生成一次性 state → 跳天权 /oauth/authorize。
 * 天权那边已登录就直接出授权确认页，未登录先要求账号 + 动态码。
 */
export default defineEventHandler((event) => {
	if (!megrezEnabled()) {
		throw createError({
			statusCode: 503,
			statusMessage: "天权未配置：请在 .env 里填写 MEGREZ_BASE / CLIENT_ID / CLIENT_SECRET / REDIRECT_URI。",
		});
	}

	const config = megrezConfig();
	const requested = getQuery(event).redirect;
	// 只接受站内相对路径，避免被拿来做开放重定向
	const next = typeof requested === "string" && requested.startsWith("/") && !requested.startsWith("//")
		? requested
		: "/";

	const state = randomUUID();

	setCookie(event, STATE_COOKIE, state, cookieOptions(event, 600));
	setCookie(event, NEXT_COOKIE, next, cookieOptions(event, 600));

	const params = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		state,
	});

	return sendRedirect(event, `${config.base}/oauth/authorize?${params.toString()}`, 302);
});
