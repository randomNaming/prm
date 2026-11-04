import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createError, type H3Error } from "h3";
import { generateText, type ModelMessage } from "ai";
import { extractJsonObject } from "../../agent/json";
import { visionModel } from "../../agent/model";
import { CARD_VISION_SYSTEM } from "../../agent/prompts";
import type { Evidence } from "../../app/types/domain";
import { contacts } from "../db/schema";
import { CONFIG } from "./config";
import { ensureCompany } from "./companies";
import { ensureContact } from "./contacts";
import { db } from "./db";
import { env, visionCapability } from "./env";
import { recordFact, type RecordFactResult } from "./facts";
import { proposeField } from "./fields";
import { nowMs } from "./ids";

export const CARD_FIELD_KEYS = [
	"name",
	"company",
	"title",
	"phone",
	"email",
	"wechat",
	"country",
	"address",
] as const;

export type CardFieldKey = (typeof CARD_FIELD_KEYS)[number];
/** 字段白名单：缺失一律空字符串，禁止 null、禁止编造。 */
export type CardFields = Record<CardFieldKey, string>;

const FIELD_TEXT = (max: number) => z.string().trim().max(max).default("");

export const cardFieldsSchema = z.object({
	name: FIELD_TEXT(CONFIG.text.maxNameLength),
	company: FIELD_TEXT(CONFIG.text.maxFieldLength),
	title: FIELD_TEXT(CONFIG.text.maxFieldLength),
	phone: FIELD_TEXT(64),
	email: FIELD_TEXT(CONFIG.text.maxFieldLength),
	wechat: FIELD_TEXT(CONFIG.text.maxFieldLength),
	country: FIELD_TEXT(64),
	address: FIELD_TEXT(CONFIG.text.maxFieldLength),
});

/** 8 个固定字段之外的信息：模型提议，确认后成为字段（field_defs.sample_value 自带值）。 */
export const cardExtraSchema = z.object({
	label: z.string().trim().min(1).max(24),
	value: z.string().trim().min(1).max(CONFIG.text.maxNoteLength),
	evidence: z.string().trim().max(60).default(""),
	confidence: z.number().min(0).max(1).default(0),
});

export type CardExtra = z.infer<typeof cardExtraSchema>;

const cardModelOutputSchema = z.object({
	fields: cardFieldsSchema.nullish().catch(emptyCardFields()),
	extras: z.array(cardExtraSchema).max(8).nullish().catch([]),
	evidence: z.record(z.string(), z.string()).nullish().catch({}),
});

export function emptyCardFields(): CardFields {
	return { name: "", company: "", title: "", phone: "", email: "", wechat: "", country: "", address: "" };
}

// ---------- 错误构造（机器码放 data.code，人话放 statusMessage） ----------

function badRequestCard(message: string): H3Error {
	return createError({ statusCode: 400, statusMessage: message, data: { code: "bad_request" } });
}

function tooLargeCard(message: string): H3Error {
	return createError({ statusCode: 413, statusMessage: message, data: { code: "too_large" } });
}

// ---------- 图片校验（只认文件头魔数，不信 Content-Type；全程内存，不落盘） ----------

export type CardImage = { mime: string; base64: string; buffer: Buffer; bytes: number };

const IMAGE_MAGIC: { mime: string; test: (buffer: Buffer) => boolean }[] = [
	{ mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
	{ mime: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
	{
		mime: "image/webp",
		test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
	},
];

export function parseCardImages(raw: unknown): CardImage[] {
	const list = z.array(z.string()).min(1).max(CONFIG.card.maxImages).safeParse(raw);
	if (!list.success) {
		throw badRequestCard(`images 必须是 1 到 ${CONFIG.card.maxImages} 张图片。`);
	}

	const images: CardImage[] = [];
	let totalChars = 0;

	for (const item of list.data) {
		const match = /^data:image\/(jpeg|png|webp);base64,([\s\S]+)$/.exec(item);
		if (!match) throw badRequestCard("图片必须是 data:image/jpeg|png|webp 开头的 base64 Data URL。");

		const base64 = match[2].replace(/\s+/g, "");
		if (base64.length > CONFIG.card.maxImageBase64Chars) {
			throw tooLargeCard("单张图片过大：base64 超过 3MB。");
		}

		const buffer = Buffer.from(base64, "base64");
		if (buffer.length === 0) throw badRequestCard("图片 base64 解码失败。");
		if (buffer.length > env().visionMaxImageBytes) {
			throw tooLargeCard("单张图片超过视觉模型允许的大小。");
		}

		const magic = IMAGE_MAGIC.find((entry) => entry.test(buffer));
		if (!magic) throw badRequestCard("图片内容不是 JPEG/PNG/WebP（按文件头判断，不听 Content-Type）。");

		totalChars += base64.length;
		images.push({ mime: magic.mime, base64, buffer, bytes: buffer.length });
	}

	if (totalChars > CONFIG.card.maxTotalBase64Chars) {
		throw tooLargeCard("图片合计过大：base64 总量超过 6MB。");
	}

	return images;
}

/** 多图判重键：各图 sha256 拼接后再 sha256；只用于证据引用，不再单独建表。 */
export function imageHashOf(images: CardImage[]): string {
	const perImage = images.map((image) => createHash("sha256").update(image.buffer).digest("hex"));

	return createHash("sha256").update(perImage.join("\n")).digest("hex");
}

// ---------- 限流：进程内滑动窗口（单实例部署即满足；重启清零可接受） ----------

const deviceWindows = new Map<string, number[]>();
let globalWindow: number[] = [];

export function resetCardRateLimit(): void {
	deviceWindows.clear();
	globalWindow = [];
}

function pruneWindow(window: number[], now: number): number[] {
	const floor = now - CONFIG.card.rateWindowMs;
	while (window.length > 0 && window[0] < floor) window.shift();

	return window;
}

export function checkCardRateLimit(deviceId: string): void {
	const now = Date.now();

	globalWindow = pruneWindow(globalWindow, now);
	if (globalWindow.length >= CONFIG.card.rateGlobal) {
		throw createError({
			statusCode: 429,
			statusMessage: "全局提交过于频繁，请稍后再试。",
			data: { code: "rate_limited" },
		});
	}

	const device = pruneWindow(deviceWindows.get(deviceId) ?? [], now);
	if (device.length >= CONFIG.card.ratePerDevice) {
		throw createError({
			statusCode: 429,
			statusMessage: `这台设备提交过于频繁（每分钟 ${CONFIG.card.ratePerDevice} 次），请稍后再试。`,
			data: { code: "rate_limited" },
		});
	}

	device.push(now);
	deviceWindows.set(deviceId, device);
	globalWindow.push(now);
}

function sanitizeEvidence(raw: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};

	for (const key of CARD_FIELD_KEYS) {
		const value = typeof raw[key] === "string" ? raw[key].trim() : "";
		if (value) out[key] = value.slice(0, CONFIG.card.maxEvidenceChars);
	}

	return out;
}

function normalizeCardFields(value: unknown): CardFields {
	const parsed = cardFieldsSchema.safeParse(value ?? {});
	if (!parsed.success) return emptyCardFields();

	return { ...emptyCardFields(), ...parsed.data };
}

export type RecognizedCard = {
	fields: CardFields;
	extras: CardExtra[];
	evidence: Record<string, string>;
	rawText: string;
	model: string;
	ms: number;
};

/** 视觉模型看图抽字段：多模态消息（图片 + 文字）→ generateText → 宽容解析。 */
export async function recognizeCard(input: {
	images: CardImage[];
	text?: string | null;
	locale?: string | null;
}): Promise<RecognizedCard> {
	const capability = visionCapability();
	if (!capability.enabled) {
		throw createError({
			statusCode: 503,
			statusMessage: capability.reason,
			data: { code: "vision_disabled" },
		});
	}

	const startedAt = Date.now();
	const lines = ["请识别这组名片图片并按约定输出 JSON。"];
	if (input.locale) lines.push(`界面语言/地区：${input.locale}`);
	if (input.text) lines.push(`端上补充文本（OCR 或手输，可能有误，仅作参考）：\n${input.text}`);

	const message: ModelMessage = {
		role: "user",
		content: [
			// ai v7 推荐 file part 承载图片（mediaType 为 image/*），兼容端仍按 image_url 发出。
			...input.images.map((image) => ({
				type: "file" as const,
				data: image.buffer,
				mediaType: image.mime,
			})),
			{ type: "text" as const, text: lines.join("\n") },
		],
	};

	const result = await generateText({
		model: visionModel(),
		system: CARD_VISION_SYSTEM,
		messages: [message],
		// 失败由 App 重传重试；不做 SDK 层重试，避免 45 秒超时翻倍。
		maxRetries: 0,
	});

	const parsed = cardModelOutputSchema.safeParse(extractJsonObject(result.text));

	return {
		fields: normalizeCardFields(parsed.success ? parsed.data.fields : {}),
		extras: parsed.success ? (parsed.data.extras ?? []) : [],
		evidence: sanitizeEvidence(parsed.success ? parsed.data.evidence ?? {} : {}),
		rawText: result.text.slice(0, CONFIG.card.maxRawTextChars),
		model: capability.model,
		ms: Date.now() - startedAt,
	};
}

// ---------- 落库：与聊天同步完全同一条路径 ----------

/** 固定字段 → recordFact 的字段名（用字段表里的中文标签，recordFact 会做 key/别名匹配）。 */
const FACT_FIELDS: { key: keyof CardFields; label: string }[] = [
	{ key: "title", label: "职位" },
	{ key: "phone", label: "电话" },
	{ key: "email", label: "邮箱" },
	{ key: "wechat", label: "微信号" },
	{ key: "country", label: "国家" },
	{ key: "address", label: "地址" },
];

export type CardScanResult = {
	ok: true;
	contactId: string;
	created: boolean;
	matchedBy: string | null;
	facts: RecordFactResult[];
	proposals: { id: string; label: string; status: string; outcome: string; value: string }[];
	extras: CardExtra[];
	meta: { model: string; ms: number; imageBytes: number; imageHash: string };
};

/**
 * 名片识别即落库：
 * 1) 按 手机/微信/姓名 匹配或新建联系人（ensureContact，和聊天导入同一个入口）
 * 2) 固定字段逐条 recordFact（字段空→applied；已有人工值→proposed）
 * 3) 额外信息逐条 proposeField（值存在 sample_value，人同意时才写入）
 * 没有草稿表，没有第二份数据。
 */
export async function intakeCard(input: {
	deviceId: string;
	images: unknown;
	text?: string | null;
	locale?: string | null;
}): Promise<CardScanResult> {
	const capability = visionCapability();
	if (!capability.enabled) {
		throw createError({
			statusCode: 503,
			statusMessage: capability.reason,
			data: { code: "vision_disabled" },
		});
	}

	checkCardRateLimit(input.deviceId);

	const images = parseCardImages(input.images);
	const hash = imageHashOf(images);
	const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);
	const recognized = await recognizeCard({ images, text: input.text, locale: input.locale });

	const fields = recognized.fields;
	if (!fields.name) {
		throw badRequestCard("没认出姓名：补拍一张清晰的正反面，或先手动建档。");
	}

	const ensured = await ensureContact({
		name: fields.name,
		phone: fields.phone || null,
		wechatId: fields.wechat || null,
	});

	if (fields.company) {
		const company = await ensureCompany(fields.company);

		await db()
			.update(contacts)
			.set({ companyId: company.id, updatedAt: nowMs() })
			.where(eq(contacts.id, ensured.id));
	}

	const evidenceOf = (quote: string): Evidence[] => [
		{
			kind: "card.photo",
			quote: (quote || fields.name).slice(0, CONFIG.card.maxEvidenceChars),
			ref: `card:${hash.slice(0, 24)}`,
			time: null,
		},
	];

	const facts: RecordFactResult[] = [];

	for (const item of FACT_FIELDS) {
		const value = fields[item.key];
		if (!value) continue;

		facts.push(
			await recordFact({
				contactId: ensured.id,
				field: item.label,
				value,
				evidence: evidenceOf(recognized.evidence[item.key] || value),
				source: "card",
			}),
		);
	}

	const proposals: CardScanResult["proposals"] = [];

	for (const extra of recognized.extras) {
		const proposed = await proposeField({
			scope: "contact",
			label: extra.label,
			sampleValue: extra.value,
			sampleRef: ensured.id,
			evidence: evidenceOf(extra.evidence || extra.value),
		});

		proposals.push({
			id: proposed.def.id,
			label: proposed.def.label,
			status: proposed.def.status,
			outcome: proposed.outcome,
			value: extra.value,
		});

		// 撞到已有且已生效的字段：直接按普通事实写入，不重复建字段。
		if (proposed.outcome === "exists" && proposed.def.status === "active") {
			await recordFact({
				contactId: ensured.id,
				field: proposed.def.key,
				value: extra.value,
				evidence: evidenceOf(extra.evidence || extra.value),
				source: "card",
			});
		}
	}

	return {
		ok: true,
		contactId: ensured.id,
		created: ensured.created,
		matchedBy: ensured.matchedBy,
		facts,
		proposals,
		extras: recognized.extras,
		meta: {
			model: recognized.model,
			ms: recognized.ms,
			imageBytes: totalBytes,
			imageHash: `sha256:${hash}`,
		},
	};
}
