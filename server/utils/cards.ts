import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { createError, type H3Error } from "h3";
import { generateText, type ModelMessage } from "ai";
import { extractJsonObject } from "../../agent/json";
import { visionModel } from "../../agent/model";
import { CARD_VISION_SYSTEM } from "../../agent/prompts";
import type { Contact } from "../../app/types/domain";
import { cardDrafts, companies, contacts } from "../db/schema";
import { CONFIG } from "./config";
import { contactKey, createContact, getContact, updateContact } from "./contacts";
import { ensureCompany } from "./companies";
import { db } from "./db";
import { agentCapability, env, visionCapability } from "./env";
import { newId, nowMs } from "./ids";
import { enqueueResearch } from "./queue";
import type { ContactInput } from "./validate";

type CardDraftRow = typeof cardDrafts.$inferSelect;

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

export const CARD_STATUSES = ["pending", "confirmed", "discarded", "failed"] as const;

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

/** 模型回包形状：解析失败或键缺失都容错成空值，宁可字段全空也不编造。 */
const cardModelOutputSchema = z.object({
	fields: cardFieldsSchema.nullish().catch(emptyCardFields()),
	evidence: z.record(z.string(), z.string()).nullish().catch({}),
});

export function emptyCardFields(): CardFields {
	return { name: "", company: "", title: "", phone: "", email: "", wechat: "", country: "", address: "" };
}

// ---------- 错误构造（机器码放 data.code，人话放 statusMessage） ----------

function badRequestCard(message: string): H3Error {
	return createError({ statusCode: 400, statusMessage: message, data: { code: "bad_request" } });
}

function notFoundCard(message: string): H3Error {
	return createError({ statusCode: 404, statusMessage: message, data: { code: "draft_not_found" } });
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

/** 多图判重键：各图 sha256 拼接后再 sha256，同一组图（无论张数）判重一致。 */
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

// ---------- 识别 ----------

export type RecognizedCard = {
	fields: CardFields;
	evidence: Record<string, string>;
	rawText: string;
	model: string;
	ms: number;
};

function normalizeCardFields(value: unknown): CardFields {
	const parsed = cardFieldsSchema.safeParse(value ?? {});
	if (!parsed.success) return emptyCardFields();

	return { ...emptyCardFields(), ...parsed.data };
}

function sanitizeEvidence(raw: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};

	for (const key of CARD_FIELD_KEYS) {
		const value = typeof raw[key] === "string" ? raw[key].trim() : "";
		if (value) out[key] = value.slice(0, CONFIG.card.maxEvidenceChars);
	}

	return out;
}

function toEvidenceMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object") return {};

	return sanitizeEvidence(value as Record<string, string>);
}

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
		// 失败即落 failed 草稿 + 502，由 App 重传重试；不做 SDK 层重试，避免 45 秒超时翻倍。
		maxRetries: 0,
	});

	const parsed = cardModelOutputSchema.safeParse(extractJsonObject(result.text));

	return {
		fields: normalizeCardFields(parsed.success ? parsed.data.fields : {}),
		evidence: sanitizeEvidence(parsed.success ? parsed.data.evidence ?? {} : {}),
		rawText: result.text.slice(0, CONFIG.card.maxRawTextChars),
		model: capability.model,
		ms: Date.now() - startedAt,
	};
}

// ---------- 去重与合并（识别阶段按「电话归一化 → 邮箱 → 姓名+公司」匹配） ----------

async function matchContactId(fields: CardFields): Promise<string | null> {
	const phone = fields.phone.trim();
	if (phone) {
		const [direct] = await db()
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.phone, phone), isNull(contacts.archivedAt)))
			.limit(1);
		if (direct) return direct.id;

		// 库里可能存成 138-0013-8000 这类写法，做一次归一化全表比对。
		const normalized = contactKey(phone);
		const candidates = await db()
			.select({ id: contacts.id, phone: contacts.phone })
			.from(contacts)
			.where(isNull(contacts.archivedAt));

		const loose = candidates.find(
			(row) => row.phone !== null && contactKey(row.phone) === normalized,
		);
		if (loose) return loose.id;
	}

	const email = fields.email.trim();
	if (email) {
		const [hit] = await db()
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.email, email), isNull(contacts.archivedAt)))
			.limit(1);
		if (hit) return hit.id;
	}

	const name = fields.name.trim();
	const company = fields.company.trim();
	if (name && company) {
		const [hit] = await db()
			.select({ id: contacts.id })
			.from(contacts)
			.innerJoin(companies, eq(companies.id, contacts.companyId))
			.where(and(eq(contacts.firstName, name), eq(companies.name, company), isNull(contacts.archivedAt)))
			.limit(1);
		if (hit) return hit.id;
	}

	return null;
}

// ---------- 草稿的增查改与清理 ----------

export type CardDraftDto = {
	id: string;
	deviceId: string;
	status: string;
	fields: CardFields;
	evidence: Record<string, string>;
	rawText: string;
	imageHash: string | null;
	matchedContactId: string | null;
	contactId: string | null;
	createdAt: number;
	confirmedAt: number | null;
	decidedNote: string | null;
};

export function toCardDraftDto(row: CardDraftRow): CardDraftDto {
	return {
		id: row.id,
		deviceId: row.deviceId,
		status: row.status,
		fields: {
			name: row.name ?? "",
			company: row.company ?? "",
			title: row.title ?? "",
			phone: row.phone ?? "",
			email: row.email ?? "",
			wechat: row.wechat ?? "",
			country: row.country ?? "",
			address: row.address ?? "",
		},
		evidence: toEvidenceMap(row.evidence),
		rawText: row.rawText ?? "",
		imageHash: row.imageHash,
		matchedContactId: row.matchedContactId,
		contactId: row.contactId,
		createdAt: row.createdAt,
		confirmedAt: row.confirmedAt,
		decidedNote: row.decidedNote,
	};
}

async function getCardDraftRow(id: string): Promise<CardDraftRow | null> {
	const [row] = await db().select().from(cardDrafts).where(eq(cardDrafts.id, id)).limit(1);

	return row ?? null;
}

/**
 * 草稿统一保留 1 天：pending 超期自动作废；confirmed/discarded/failed 超期清理
 * （数据已进 contacts，草稿即操作流水，也不需要了）。在每次读写入口惰性触发。
 */
export async function sweepCardDrafts(): Promise<void> {
	const floor = nowMs() - CONFIG.card.retentionMs;

	await db()
		.update(cardDrafts)
		.set({ status: "discarded", decidedNote: "超过 1 天未确认，自动丢弃。" })
		.where(and(eq(cardDrafts.status, "pending"), lte(cardDrafts.createdAt, floor)));

	await db()
		.delete(cardDrafts)
		.where(
			and(
				inArray(cardDrafts.status, ["confirmed", "discarded", "failed"]),
				lte(cardDrafts.createdAt, floor),
			),
		);
}

export type CardIntakeResult = {
	ok: true;
	draft: CardDraftDto;
	meta: { model: string; ms: number; imageBytes: number; imageHash: string; deduped: boolean };
};

/** 收图并识别：校验 → 哈希判重 → 限流 → 调视觉模型 → 落草稿（失败也落 failed 行）。 */
export async function intakeCard(input: {
	deviceId: string;
	images: unknown;
	text?: string | null;
	locale?: string | null;
}): Promise<CardIntakeResult> {
	const capability = visionCapability();
	if (!capability.enabled) {
		throw createError({
			statusCode: 503,
			statusMessage: capability.reason,
			data: { code: "vision_disabled" },
		});
	}

	await sweepCardDrafts();

	const images = parseCardImages(input.images);
	const hash = imageHashOf(images);
	const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);

	// 同一组图重复提交：直接返回已有 pending 草稿，不再调模型（省钱），也不占限流额度。
	const [existing] = await db()
		.select()
		.from(cardDrafts)
		.where(and(eq(cardDrafts.imageHash, hash), eq(cardDrafts.status, "pending")))
		.orderBy(desc(cardDrafts.createdAt))
		.limit(1);

	if (existing) {
		return {
			ok: true,
			draft: toCardDraftDto(existing),
			meta: {
				model: existing.model ?? capability.model,
				ms: existing.ms ?? 0,
				imageBytes: totalBytes,
				imageHash: `sha256:${hash}`,
				deduped: true,
			},
		};
	}

	checkCardRateLimit(input.deviceId);

	const startedAt = Date.now();

	let recognized: RecognizedCard;
	try {
		recognized = await recognizeCard({ images, text: input.text, locale: input.locale });
	} catch (error) {
		// 识别失败也要留痕：写一条 failed 草稿（只有元数据，无字段值），方便排障。
		const reason = (error instanceof Error ? error.message : String(error)).slice(0, 255);
		const failedId = newId();
		const at = nowMs();

		await db().insert(cardDrafts).values({
			id: failedId,
			deviceId: input.deviceId,
			status: "failed",
			imageHash: hash,
			imageBytes: totalBytes,
			model: capability.model,
			ms: Date.now() - startedAt,
			error: reason,
			createdAt: at,
		});

		throw createError({
			statusCode: 502,
			statusMessage: `视觉模型调用失败：${reason}`.slice(0, 200),
			data: { code: "vision_failed", draftId: failedId },
		});
	}

	const matchedContactId = await matchContactId(recognized.fields);
	const id = newId();

	await db().insert(cardDrafts).values({
		id,
		deviceId: input.deviceId,
		status: "pending",
		name: recognized.fields.name || null,
		company: recognized.fields.company || null,
		title: recognized.fields.title || null,
		phone: recognized.fields.phone || null,
		email: recognized.fields.email || null,
		wechat: recognized.fields.wechat || null,
		country: recognized.fields.country || null,
		address: recognized.fields.address || null,
		evidence: recognized.evidence,
		rawText: recognized.rawText || null,
		imageHash: hash,
		imageBytes: totalBytes,
		model: recognized.model,
		ms: recognized.ms,
		matchedContactId,
		createdAt: nowMs(),
	});

	const row = await getCardDraftRow(id);
	if (!row) throw new Error("名片草稿创建失败。");

	return {
		ok: true,
		draft: toCardDraftDto(row),
		meta: {
			model: recognized.model,
			ms: recognized.ms,
			imageBytes: totalBytes,
			imageHash: `sha256:${hash}`,
			deduped: false,
		},
	};
}

export async function listCardDrafts(input: {
	status?: string;
	limit?: number;
}): Promise<CardDraftDto[]> {
	await sweepCardDrafts();

	const status = CARD_STATUSES.includes((input.status ?? "pending") as (typeof CARD_STATUSES)[number])
		? (input.status ?? "pending")
		: "pending";
	const limit = Math.min(
		Math.max(input.limit ?? CONFIG.card.draftListDefault, 1),
		CONFIG.card.draftListMax,
	);

	const rows = await db()
		.select()
		.from(cardDrafts)
		.where(eq(cardDrafts.status, status))
		.orderBy(desc(cardDrafts.createdAt))
		.limit(limit);

	return rows.map(toCardDraftDto);
}

// ---------- 确认 / 丢弃：人改完的最终值才碰 contacts ----------

export type CardConfirmResult = { ok: true; contactId: string; action: "created" | "updated" };

function toContactInput(fields: CardFields, companyId: string | null): ContactInput {
	return {
		firstName: fields.name,
		lastName: null,
		title: fields.title || null,
		email: fields.email || null,
		phone: fields.phone || null,
		wechatId: fields.wechat || null,
		address: fields.address || null,
		country: fields.country || null,
		postalCode: null,
		customerGrade: null,
		businessRole: null,
		relationshipState: null,
		repairNote: null,
		linkedin: null,
		github: null,
		notes: null,
		companyId,
	};
}

/** 确认更新 = 只写本次提交的非空字段，空字符串不覆盖原值（保护人工数据）。 */
function mergeContactInput(existing: Contact, fields: CardFields, companyId: string | null): ContactInput {
	const pick = (submitted: string, current: string | null) => (submitted ? submitted : (current ?? ""));

	return {
		firstName: fields.name || existing.firstName,
		lastName: existing.lastName,
		title: pick(fields.title, existing.title),
		email: pick(fields.email, existing.email),
		phone: pick(fields.phone, existing.phone),
		wechatId: pick(fields.wechat, existing.wechatId),
		address: pick(fields.address, existing.address),
		country: pick(fields.country, existing.country),
		postalCode: existing.postalCode,
		customerGrade: existing.customerGrade,
		businessRole: existing.businessRole,
		relationshipState: existing.relationshipState,
		repairNote: existing.repairNote,
		linkedin: existing.linkedin,
		github: existing.github,
		notes: existing.notes,
		companyId,
	};
}

/** 提交了公司名就按现有通道「找到或新建」公司；没提交则保留联系人现有归属。 */
async function resolveCompanyId(submitted: string, fallback: string | null): Promise<string | null> {
	if (!submitted) return fallback;

	const { id } = await ensureCompany(submitted);

	return id;
}

export async function confirmCardDraft(
	id: string,
	body: unknown,
	note?: string | null,
): Promise<CardConfirmResult> {
	await sweepCardDrafts();

	const parsed = z.object({ fields: cardFieldsSchema }).safeParse(body ?? {});
	if (!parsed.success) throw badRequestCard("参数不对：body 里要有 fields 字段对象。");

	const fields = normalizeCardFields(parsed.data.fields);
	if (!fields.name) throw badRequestCard("姓名不能为空：确认建档时 name 必填。");

	const draft = await getCardDraftRow(id);
	if (!draft || draft.status !== "pending") throw notFoundCard("草稿不存在或已处理。");

	let contactId: string;
	let action: "created" | "updated";

	const matched = draft.matchedContactId ? await getContact(draft.matchedContactId) : null;

	if (matched) {
		contactId = matched.id;
		action = "updated";
		const companyId = await resolveCompanyId(fields.company, matched.companyId);
		await updateContact(matched.id, mergeContactInput(matched, fields, companyId));
	} else {
		const companyId = await resolveCompanyId(fields.company, null);
		const created = await createContact(toContactInput(fields, companyId));
		contactId = created.id;
		action = "created";

		// 与手工建档同一条路径：智能体开着就补一次后台研究。
		if (agentCapability().enabled) {
			await enqueueResearch(contactId, "名片确认建档，自动触发一次后台研究。");
		}
	}

	await db()
		.update(cardDrafts)
		.set({
			status: "confirmed",
			contactId,
			confirmedAt: nowMs(),
			decidedNote: note?.trim() || null,
		})
		.where(eq(cardDrafts.id, id));

	return { ok: true, contactId, action };
}

export async function discardCardDraft(
	id: string,
	note?: string | null,
): Promise<{ ok: true }> {
	await sweepCardDrafts();

	const draft = await getCardDraftRow(id);
	if (!draft || draft.status !== "pending") throw notFoundCard("草稿不存在或已处理。");

	await db()
		.update(cardDrafts)
		.set({ status: "discarded", decidedNote: note?.trim() || "人工丢弃。" })
		.where(eq(cardDrafts.id, id));

	return { ok: true };
}
