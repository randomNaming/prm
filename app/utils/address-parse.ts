import { normalizeCountry } from "./countries";

/**
 * 完整地址文本解析（参考阿里国际站的智能填写）。
 *
 * 纯启发式、纯前端：按逗号切段后依次认出国家（对常量表归一）、电话、邮箱、
 * 姓名、邮编、城市/省州，剩下的段做街道行 —— 街道行之间做缩写归一去重
 * （「18 Bd Vincent Auriol」和「18 Boulevard Vincent Auriol」是同一条，保留长的那条）。
 *
 * 邮编和城市的先后按原文位置判断：欧式「31170 Tournefeuille」邮编在前，
 * 美式「norristown, pa 19401」城市在前。
 *
 * 认错的代价很低：结果全部落进表单，人在保存前看得见、改得动。所以规则刻意保守，
 * 只有一段孤立文本时宁可返回 null，绝不为了凑满字段而编。
 */
export type ParsedAddress = {
	name: string | null;
	phone: string | null;
	email: string | null;
	/** 标准中文国名（normalizeCountry 归一后的结果）。 */
	country: string | null;
	postalCode: string | null;
	city: string | null;
	region: string | null;
	/** 去重后的街道行。 */
	street: string | null;
	/** 建议存进联系人「地址」的整串：街道 + 城市 + 省州（邮编有自己的字段，不并进来）。 */
	address: string | null;
	/** address + 邮编 + 国家，一键复制用的完整寄收件地址。 */
	fullAddress: string | null;
};

type Segment = {
	text: string;
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/** 电话候选：允许 + 前缀、空格/横线/括号分隔。 */
const PHONE_RE = /\+?\d[\d\s\-().]{5,}\d/g;

const STREET_ABBREVIATIONS: Record<string, string> = {
	bd: "boulevard",
	blvd: "boulevard",
	boul: "boulevard",
	ave: "avenue",
	av: "avenue",
	avn: "avenue",
	rd: "road",
	dr: "drive",
	drv: "drive",
	ln: "lane",
	sq: "square",
	hwy: "highway",
	apt: "apartment",
	ste: "suite",
};

/** 街道行的比较键：展开缩写、去标点、压空白，让缩写写法和全称认成同一条。 */
function streetKey(value: string): string {
	return value
		.toLowerCase()
		.replace(/[.,]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => STREET_ABBREVIATIONS[word] ?? word)
		.join(" ");
}

function digitsOnly(value: string): number {
	return (value.match(/\d/g) ?? []).length;
}

export function parseAddress(input: string): ParsedAddress | null {
	const text = input.trim();
	if (!text) return null;

	const parsed: ParsedAddress = {
		name: null,
		phone: null,
		email: null,
		country: null,
		postalCode: null,
		city: null,
		region: null,
		street: null,
		address: null,
		fullAddress: null,
	};

	const email = text.match(EMAIL_RE);
	if (email) parsed.email = email[0];

	// 按逗号/分号切段；中文逗号也照顾一下（从聊天记录里抄来的地址可能是中英混排）。
	let segments: Segment[] = text
		.split(/[,;，；]+/)
		.map((token) => ({ text: token.trim() }))
		.filter((segment) => segment.text);
	const segmentCount = segments.length;

	// 国家：从后往前认，认出即摘走 —— 国家几乎总在结尾。
	for (let i = segments.length - 1; i >= 0; i -= 1) {
		const country = normalizeCountry(segments[i].text.replace(/\./g, ""));
		if (country) {
			parsed.country = country;
			segments.splice(i, 1);
			break;
		}
	}

	// 电话：优先带 + 的国际号码；纯数字要 8 位以上，避免把邮编当电话吞掉。
	for (let i = 0; i < segments.length; i += 1) {
		const matches = segments[i].text.match(PHONE_RE);
		if (!matches) continue;

		const candidate = matches.find(
			(match) => (match.startsWith("+") && digitsOnly(match) >= 6) || digitsOnly(match) >= 8,
		);
		if (candidate) {
			parsed.phone = candidate.trim();
			segments[i].text = segments[i].text.replace(candidate, " ").replace(/\s+/g, " ").trim();
			break;
		}
	}
	segments = segments.filter((segment) => segment.text);

	// 姓名：开头那段不带数字的短文本（收发件人）。带门牌号的是街道；
	// 地址不可能只有姓名一段，所以后面还有别的段时才认。
	if (segments.length > 1 && !/\d/.test(segments[0].text) && segments[0].text.length <= 60) {
		parsed.name = segments[0].text;
		segments = segments.slice(1);
	}

	// 邮编：纯数字（3-10 位）或英国式字母数字；「州缩写 + 邮编」（pa 19401）一并认出省州。
	for (let i = 0; i < segments.length; i += 1) {
		const token = segments[i].text;
		const stateZip = token.match(/^[A-Za-z]{1,2}\s+(\d{4,6})$/);

		if (stateZip) {
			parsed.postalCode = stateZip[1];
			parsed.region = token.slice(0, token.length - stateZip[1].length).trim();
			segments.splice(i, 1);
			break;
		}
		if (/^\d{3,10}$/.test(token) || /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test(token)) {
			parsed.postalCode = token;
			segments.splice(i, 1);
			break;
		}
	}

	// 城市与省州：末尾不带门牌号的段。至少留一段给街道，避免中文地址整段被吃掉。
	const trailing: Segment[] = [];
	while (segments.length > 1 && !/^\d/.test(segments[segments.length - 1].text)) {
		trailing.unshift(segments.pop() as Segment);
	}
	if (trailing.length === 1) {
		parsed.city = trailing[0].text;
	} else if (trailing.length >= 2) {
		parsed.city = trailing[trailing.length - 2].text;
		parsed.region = trailing[trailing.length - 1].text;
	}

	// 剩下的都是街道行：缩写归一去重，保留更完整的写法。
	const streets: string[] = [];
	for (const segment of segments) {
		const key = streetKey(segment.text);
		const duplicate = streets.find((existing) => {
			const existingKey = streetKey(existing);
			return existingKey === key || existingKey.includes(key) || key.includes(existingKey);
		});

		if (!duplicate) {
			streets.push(segment.text);
		} else if (segment.text.length > duplicate.length) {
			streets[streets.indexOf(duplicate)] = segment.text;
		}
	}
	parsed.street = streets.join(", ") || null;

	// 地址串 = 街道 + 城市 + 省州；邮编落自己的字段，不在地址里重复一份。
	const regionPart = parsed.region && parsed.region !== parsed.city ? parsed.region : null;
	const addressParts = [...streets, parsed.city, regionPart].filter(
		(part): part is string => Boolean(part && part.trim()),
	);
	parsed.address = addressParts.join(", ") || null;
	parsed.fullAddress = [parsed.address, parsed.postalCode, parsed.country]
		.filter(Boolean)
		.join(", ") || null;

	// 结构化信息一件都没有、又只有一段文本时，多半是随手粘的话，不是地址。
	const structured =
		segmentCount > 1 ||
		Boolean(parsed.phone || parsed.email || parsed.country || parsed.postalCode);

	return structured ? parsed : null;
}
