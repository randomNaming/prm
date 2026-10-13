import { z } from "zod";
import { ACTIVITY_KINDS, DEAL_STAGES, FIELD_SCOPES } from "../../app/types/domain";
import { CONFIG } from "./config";

const text = (max: number) => z.string().trim().max(max);

const blankToNull = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.nullish()
		.transform((value) => (value === null || value === undefined || value === "" ? null : value));

export const contactInput = z.object({
	firstName: text(CONFIG.text.maxNameLength).min(1, "姓名不能为空"),
	lastName: blankToNull(CONFIG.text.maxNameLength),
	title: blankToNull(CONFIG.text.maxFieldLength),
	email: blankToNull(CONFIG.text.maxFieldLength),
	phone: blankToNull(64),
	wechatId: blankToNull(CONFIG.text.maxFieldLength),
	address: blankToNull(CONFIG.text.maxFieldLength),
	businessRole: blankToNull(32),
	relationshipState: blankToNull(32),
	repairNote: blankToNull(CONFIG.text.maxFieldLength),
	linkedin: blankToNull(CONFIG.text.maxFieldLength),
	github: blankToNull(CONFIG.text.maxFieldLength),
	notes: blankToNull(CONFIG.text.maxNoteLength),
	companyId: blankToNull(36),
});

export const companyInput = z.object({
	name: text(CONFIG.text.maxNameLength).min(1, "公司名称不能为空"),
	domain: blankToNull(CONFIG.text.maxFieldLength),
	industry: blankToNull(CONFIG.text.maxFieldLength),
	address: blankToNull(CONFIG.text.maxFieldLength),
	cooperationRole: blankToNull(32),
	description: blankToNull(CONFIG.text.maxNoteLength),
});

export const dealInput = z.object({
	name: text(CONFIG.text.maxNameLength).min(1, "商机名称不能为空"),
	companyId: blankToNull(36),
	contactId: blankToNull(36),
	stage: z.enum(DEAL_STAGES).default("初步接触"),
	expectedCloseDate: z
		.string()
		.trim()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "预计成交日格式为 YYYY-MM-DD")
		.nullish()
		.transform((value) => (value === null || value === undefined || value === "" ? null : value)),
});

export const dealStageInput = z.object({
	stage: z.enum(DEAL_STAGES),
});

export const activityInput = z.object({
	kind: z.enum(ACTIVITY_KINDS).default("note"),
	title: text(CONFIG.text.maxNameLength).min(1, "标题不能为空"),
	body: blankToNull(CONFIG.text.maxNoteLength),
	contactId: blankToNull(36),
	companyId: blankToNull(36),
	dealId: blankToNull(36),
	dueAt: z.number().int().positive().nullish(),
});

export const listQuery = z.object({
	q: z.string().trim().max(CONFIG.lists.maxSearchLength).optional().default(""),
	page: z.coerce.number().int().min(1).optional().default(1),
	pageSize: z.coerce.number().int().min(1).max(CONFIG.lists.maxPageSize).optional().default(CONFIG.lists.pageSize),
	archived: z
		.preprocess((value) => (typeof value === "string" ? value === "true" : value), z.boolean())
		.optional()
		.default(false),
	/**
	 * 按关系维护筛选联系人。
	 * 传 `__blank__` 表示「默认」那一档 —— 也就是长期养着、能进群发池的人。
	 */
	relationship: z.string().trim().max(32).optional(),
});

export const evidenceItem = z.object({
	kind: text(64).min(1, "证据缺少来源类型"),
	quote: text(CONFIG.text.maxQuoteLength).min(1, "证据缺少原文摘录"),
	ref: blankToNull(CONFIG.text.maxFieldLength),
});

export const recordFactInput = z.object({
	contactId: z.string().trim().min(1).max(36),
	field: text(64).min(1, "字段不能为空"),
	value: text(CONFIG.text.maxFieldLength).min(1, "字段值不能为空"),
	evidence: z.array(evidenceItem).min(1, "无一手来源不写：证据至少一条"),
	source: text(16).default("agent"),
});

export const recordCompanyFactInput = z.object({
	companyId: z.string().trim().min(1).max(36),
	field: text(64).min(1, "字段不能为空"),
	value: text(CONFIG.text.maxNoteLength).min(1, "字段值不能为空"),
	evidence: z.array(evidenceItem).min(1, "无一手来源不写：证据至少一条"),
	source: text(16).default("agent"),
});

export const ensureContactInput = z.object({
	name: text(CONFIG.text.maxNameLength).min(1, "姓名不能为空"),
	wechatId: blankToNull(CONFIG.text.maxFieldLength),
	phone: blankToNull(64),
	evidence: z.array(evidenceItem).min(1, "无一手来源不写：证据至少一条"),
	source: text(16).default("agent"),
});

export const proposeFieldInput = z.object({
	scope: z.enum(FIELD_SCOPES),
	label: text(24).min(1, "字段名不能为空"),
	sampleValue: blankToNull(CONFIG.text.maxNoteLength),
	evidence: z.array(evidenceItem).min(1, "提出新字段也要给原文证据"),
});

export const chatInput = z.object({
	conversationId: z.string().trim().min(1).max(36).nullish(),
	contactId: blankToNull(36),
	companyId: blankToNull(36),
	dealId: blankToNull(36),
	message: text(CONFIG.text.maxNoteLength).min(1, "消息不能为空"),
});

export const conversationQuery = z.object({
	contactId: blankToNull(36),
	companyId: blankToNull(36),
	dealId: blankToNull(36),
});

export type ContactInput = z.infer<typeof contactInput>;
export type CompanyInput = z.infer<typeof companyInput>;
export type DealInput = z.infer<typeof dealInput>;
export type ActivityInput = z.infer<typeof activityInput>;
export type ListQuery = z.infer<typeof listQuery>;
export type RecordFactInput = z.infer<typeof recordFactInput>;
export type RecordCompanyFactInput = z.infer<typeof recordCompanyFactInput>;
export type ProposeFieldInput = z.infer<typeof proposeFieldInput>;
export type EnsureContactInput = z.infer<typeof ensureContactInput>;
export type EvidenceItem = z.infer<typeof evidenceItem>;
export type ChatInput = z.infer<typeof chatInput>;
