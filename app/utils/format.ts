export function formatDate(value: number | null | undefined): string {
	if (!value) return "—";

	const date = new Date(value);
	const pad = (input: number) => String(input).padStart(2, "0");

	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDateTime(value: number | null | undefined): string {
	if (!value) return "—";

	const date = new Date(value);
	const pad = (input: number) => String(input).padStart(2, "0");

	return `${formatDate(value)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatRelative(value: number | null | undefined): string {
	if (!value) return "—";

	const diff = Date.now() - value;
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;

	if (diff < minute) return "刚刚";
	if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
	if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
	if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;

	return formatDate(value);
}

export function daysBetween(value: number | null | undefined, now = Date.now()): number {
	if (!value) return 0;

	return Math.max(0, Math.floor((now - value) / (24 * 60 * 60 * 1000)));
}

export function stageDuration(value: number | null | undefined): string {
	if (!value) return "—";

	const days = daysBetween(value);

	return days === 0 ? "今天进入本阶段" : `停留 ${days} 天`;
}

export function personName(person: {
	firstName?: string | null;
	lastName?: string | null;
}): string {
	const first = (person.firstName ?? "").trim();
	const last = (person.lastName ?? "").trim();

	if (!first) return last;
	if (!last) return first;

	// 拉丁名之间补空格（David McGowan）；中文名是「姓 + 名」，直接拼（李思远）。
	return /[A-Za-z]$/.test(first) && /^[A-Za-z]/.test(last)
		? `${first} ${last}`
		: `${first}${last}`;
}
