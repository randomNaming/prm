import { COUNTRIES } from "../../app/utils/countries";
import type { PublicHoliday } from "../../app/types/domain";

/**
 * 公众假期取数（Nager.Date，免密钥）。
 *
 * 只在服务端跑、只在内存里缓存：假期一年才变一次，没必要为每个请求打一次公网。
 * 请求失败一律当「暂时没有数据」处理，错误往上抛给接口层转成占位结果 ——
 * 日历卡不该因为公网抖动把整页拖进错误态。
 */

const CACHE_TTL = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; items: PublicHoliday[] }>();

/** 中文国名 / 英文全称 / 两位代码 → ISO 两位代码；认不出来返回 null。 */
export function countryCodeOf(value: string): string | null {
	const raw = value.trim();
	if (!raw) return null;

	const upper = raw.toUpperCase();

	return (
		COUNTRIES.find((country) => country.code === upper)?.code ??
		COUNTRIES.find((country) => country.zh === raw)?.code ??
		COUNTRIES.find((country) => country.en.toLowerCase() === raw.toLowerCase())?.code ??
		null
	);
}

export async function fetchPublicHolidays(code: string, year: number): Promise<PublicHoliday[]> {
	const key = `${code}-${year}`;
	const hit = cache.get(key);

	if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;

	const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`, {
		signal: AbortSignal.timeout(6000),
		headers: { accept: "application/json" },
	});

	if (!response.ok) throw new Error(`公共假期服务返回 ${response.status}`);

	const raw = (await response.json()) as Array<{
		date: string;
		name: string;
		localName: string;
		global?: boolean;
	}>;

	// 只留全国性假期：州/省特有的纪念日会让日历天天冒红点，反而没有信息量。
	const items = raw
		.filter((holiday) => holiday.global !== false)
		.map((holiday) => ({
			date: holiday.date,
			name: holiday.name,
			localName: holiday.localName,
		}))
		.sort((left, right) => left.date.localeCompare(right.date));

	cache.set(key, { at: Date.now(), items });

	return items;
}
