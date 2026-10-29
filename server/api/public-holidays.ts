import { badRequest } from "../utils/guard";
import { countryCodeOf, fetchPublicHolidays } from "../utils/holidays";

/**
 * GET /api/public-holidays?country=澳大利亚&year=2026
 *
 * 联系人的日历卡用：返回该国当年的全国性公众假期。
 * 认不出的国家、公网取不到、年份越界都返回 source = unavailable + 人话原因，
 * 由前端渲染空日历占位；这里刻意不抛 5xx，避免一个装饰性卡片把页面带进错误页。
 */
export default defineEventHandler(async (event) => {
	const query = getQuery(event);
	const country = String(query.country ?? "").trim();
	const year = Number(query.year ?? new Date().getFullYear());

	if (!country) throw badRequest("缺少 country 参数。");

	if (!Number.isInteger(year) || year < 2000 || year > 2100) {
		throw badRequest("year 参数不合法。");
	}

	const code = countryCodeOf(country);

	if (!code) {
		return {
			country,
			code: null,
			year,
			holidays: [],
			source: "unavailable",
			reason: "这个国家还没有假期数据源。",
		} as const;
	}

	try {
		const holidays = await fetchPublicHolidays(code, year);

		return { country, code, year, holidays, source: "nager", reason: null } as const;
	} catch {
		return {
			country,
			code,
			year,
			holidays: [],
			source: "unavailable",
			reason: "公共假期服务暂时连不上。",
		} as const;
	}
});
