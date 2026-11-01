import { deleteCookie, getRequestHeader, sendRedirect } from "h3";
import { SESSION_COOKIE, STATE_COOKIE, NEXT_COOKIE, megrezConfig, megrezEnabled } from "../../utils/megrez";

/**
 * 退出：先清本站 Cookie，再把浏览器送到天权的 GET /logout，并带上回跳地址。
 *
 * 只清本站会话是不够的：天权那边的会话（默认 12 小时）还在，下次访问会被自动放行。
 * 带上 next 是为了让天权退出后直接回到本站，而不是停在它的后台首页。
 */
export default defineEventHandler((event) => {
	deleteCookie(event, SESSION_COOKIE, { path: "/" });
	deleteCookie(event, STATE_COOKIE, { path: "/" });
	deleteCookie(event, NEXT_COOKIE, { path: "/" });

	if (!megrezEnabled()) return sendRedirect(event, "/", 302);

	const proto = (getRequestHeader(event, "x-forwarded-proto") ?? "http").split(",")[0]?.trim() || "http";
	const host = getRequestHeader(event, "host") ?? "";
	const home = host ? `${proto}://${host}/` : "/";

	const target = `${megrezConfig().base}/logout?next=${encodeURIComponent(home)}`;

	return sendRedirect(event, target, 302);
});
