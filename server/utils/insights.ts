import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { InsightKind, PlaybookPayload, RelationshipInsight } from "../../app/types/domain";
import { relationshipInsights } from "../db/schema";
import { db } from "./db";
import { newId, nowMs } from "./ids";
import { factStatus, parseEvidence } from "./parse";
import type { Evidence } from "../../app/types/domain";

/**
 * 关系洞察的写路径：相处说明书与双轨温度计。
 *
 * payload 刻意只做宽松校验（验顶层 shape 与数组项的关键键），不逐字段锁死 ——
 * 这是 LLM 的输出，格式漂移时宁可原样落库让人看到，也不能让一轮导入整体失败。
 *
 * V2 的 playbook 条目从 {text, quote, time} 升级为 {title, attribution, confidence,
 * evidence_quote, evidence_time}。写路径同时接受两种形状并归一成 V2 存储；
 * 读路径（latestInsights）对历史行做同样的归一化，所以消费方只见 V2。
 */

const insightItemSchema = z
	.object({
		// V2 主字段：短标题 + 深层归因 + 置信度 + 证据。
		title: z.string().trim().min(1).max(60).optional(),
		attribution: z.string().trim().max(500).optional(),
		confidence: z.number().int().min(0).max(100).nullish(),
		evidence_quote: z.string().trim().min(1).max(1000).optional(),
		evidence_time: z.string().trim().max(32).nullish(),
		// 旧字段仍接受：模型偶尔照旧格式输出时，条目不至于整段拒收。
		text: z.string().trim().min(1).max(400).optional(),
		quote: z.string().trim().min(1).max(1000).optional(),
		time: z.string().trim().max(32).nullish(),
	})
	.refine((value) => Boolean(value.title ?? value.text), "缺少 title 或 text")
	.refine((value) => Boolean(value.evidence_quote ?? value.quote), "缺少原话证据")
	.transform((value) => ({
		title: (value.title ?? value.text ?? "").trim(),
		attribution: value.attribution?.trim() || null,
		confidence: value.confidence ?? null,
		quote: (value.evidence_quote ?? value.quote ?? "").trim(),
		time: value.evidence_time ?? value.time ?? null,
	}));

const spectrumSideSchema = z.object({
	score: z.number().min(0).max(100),
	note: z.string().trim().max(200).default(""),
});

const personalitySpectrumsSchema = z.object({
	rigor_vs_flexibility: spectrumSideSchema,
	transactional_vs_relational: spectrumSideSchema,
	trust_mechanism: spectrumSideSchema,
});

const personalHookSchema = z.object({
	category: z.string().trim().min(1).max(32),
	detail: z.string().trim().min(1).max(400),
	quote: z.string().trim().min(1).max(1000),
	time: z.string().trim().max(32).nullish().transform((value) => value ?? null),
});

/** 模型偶尔会把双语破冰话术写成一段字符串，归一成 {zh, en} 存储。 */
const icebreakerSchema = z
	.union([
		z.object({
			zh: z.string().trim().min(1).max(400),
			en: z.string().trim().max(400).default(""),
		}),
		z.string().trim().min(1).max(400),
	])
	.transform((value) => (typeof value === "string" ? { zh: value, en: "" } : value));

const smallTalkPlaybookSchema = z.object({
	strategy_advice: z.string().trim().max(400).default(""),
	personal_hooks: z.array(personalHookSchema).max(12).default([]),
	ready_to_use_icebreaker: icebreakerSchema.nullish().transform((value) => value ?? null),
});

const playbookSchema = z.object({
	counterpart_type: z.enum(["customer", "supplier", "friend"]),
	// 短标签约定 ≤10 字是提示词的硬约束；这里放宽到 32 只是防整段拒收，超长标签由提示词自律。
	executive_summary: z
		.string()
		.trim()
		.min(1)
		.max(300)
		.nullish()
		.transform((value) => value || null),
	short_tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
	personality_spectrums: personalitySpectrumsSchema.nullish().transform((value) => value ?? null),
	small_talk_playbook: smallTalkPlaybookSchema.nullish().transform((value) => value ?? null),
	profile: z.array(insightItemSchema).max(12).default([]),
	business_value: z.array(insightItemSchema).max(8).default([]),
	pain_points: z.array(insightItemSchema).max(10).default([]),
	sweet_spots: z.array(insightItemSchema).max(10).default([]),
	taboos: z.array(insightItemSchema).max(10).default([]),
});

const dualTrackSideSchema = z.object({
	level: z.string().trim().min(1).max(32),
	score: z.number().min(-100).max(100).nullish().transform((value) => value ?? null),
	note: z.string().trim().max(600).default(""),
	quote: z.string().trim().max(1000).nullish().transform((value) => value ?? null),
	time: z.string().trim().max(32).nullish().transform((value) => value ?? null),
});

const dualTrackSchema = z.object({
	transaction_health: dualTrackSideSchema,
	personal_trust: dualTrackSideSchema,
});

const payloadSchemas: Record<InsightKind, z.ZodTypeAny> = {
	playbook: playbookSchema,
	dual_track: dualTrackSchema,
};

export type RecordInsightResult = {
	stored: boolean;
	kind: InsightKind;
	reason: string;
};

export async function recordInsight(input: {
	contactId: string;
	kind: InsightKind;
	payload: unknown;
	evidence: Evidence[];
	source?: string;
}): Promise<RecordInsightResult> {
	const schema = payloadSchemas[input.kind];

	if (!schema) {
		return { stored: false, kind: input.kind, reason: `未知洞察类型 ${input.kind}。` };
	}

	const parsed = schema.safeParse(input.payload);
	if (!parsed.success) {
		return {
			stored: false,
			kind: input.kind,
			reason: `payload 结构不对（${parsed.error.issues[0]?.path.join(".")}），请按格式重试。`,
		};
	}

	const at = nowMs();

	// 整段刷新：同 kind 旧版退场，历史保留。
	const previous = await db()
		.update(relationshipInsights)
		.set({ status: "superseded" })
		.where(
			and(
				eq(relationshipInsights.contactId, input.contactId),
				eq(relationshipInsights.kind, input.kind),
				eq(relationshipInsights.status, "applied"),
			),
		);

	await db()
		.insert(relationshipInsights)
		.values({
			id: newId(),
			contactId: input.contactId,
			kind: input.kind,
			payload: parsed.data,
			evidence: input.evidence,
			source: input.source ?? "agent",
			status: "applied",
			createdAt: at,
		});

	const refreshed = previous[0].affectedRows > 0;

	return {
		stored: true,
		kind: input.kind,
		reason: refreshed ? "已刷新旧版洞察。" : "已写入首版洞察。",
	};
}

// ===== 读取路径的旧数据归一化 =====
//
// V2 之前落库的 playbook 行没有顶层四组新字段，条目也还是 {text, quote, time}。
// 归一化只做形状搬运、不做语义加工：title 退回 text，缺的补 null / 空数组。

function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asScore(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function normalizeItems(value: unknown): PlaybookPayload["business_value"] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry) => {
		const item = (entry ?? {}) as Record<string, unknown>;
		const title = asString(item.title ?? item.text);
		const quote = asString(item.evidence_quote ?? item.quote);
		if (!title || !quote) return [];

		return [
			{
				title,
				attribution: asString(item.attribution) || null,
				confidence: typeof item.confidence === "number" ? Math.round(item.confidence) : null,
				quote,
				time: asString(item.evidence_time ?? item.time) || null,
			},
		];
	});
}

function normalizeSpectrums(value: unknown): PlaybookPayload["personality_spectrums"] {
	const source = (value ?? {}) as Record<string, unknown>;
	const side = (entry: unknown) => {
		const item = (entry ?? {}) as Record<string, unknown>;
		const score = asScore(item.score);
		if (score === null) return null;

		return { score, note: asString(item.note) };
	};
	const rigor = side(source.rigor_vs_flexibility);
	const relational = side(source.transactional_vs_relational);
	const trust = side(source.trust_mechanism);
	if (!rigor || !relational || !trust) return null;

	return {
		rigor_vs_flexibility: rigor,
		transactional_vs_relational: relational,
		trust_mechanism: trust,
	};
}

function normalizeSmallTalk(value: unknown): PlaybookPayload["small_talk_playbook"] {
	const source = (value ?? {}) as Record<string, unknown>;
	if (typeof source !== "object" || source === null || Object.keys(source).length === 0) return null;

	const hooks = Array.isArray(source.personal_hooks)
		? source.personal_hooks.flatMap((entry) => {
				const hook = (entry ?? {}) as Record<string, unknown>;
				const category = asString(hook.category);
				const detail = asString(hook.detail);
				const quote = asString(hook.quote);
				if (!category || !detail || !quote) return [];

				return [{ category, detail, quote, time: asString(hook.time) || null }];
			})
		: [];

	const raw = source.ready_to_use_icebreaker;
	const ice =
		typeof raw === "string"
			? { zh: raw.trim(), en: "" }
			: typeof raw === "object" && raw !== null
				? {
						zh: asString((raw as Record<string, unknown>).zh),
						en: asString((raw as Record<string, unknown>).en),
					}
				: null;
	const icebreaker = ice && ice.zh ? { zh: ice.zh, en: ice.en } : null;

	const advice = asString(source.strategy_advice);
	if (!advice && hooks.length === 0 && !icebreaker) return null;

	return { strategy_advice: advice, personal_hooks: hooks, ready_to_use_icebreaker: icebreaker };
}

export function normalizePlaybookPayload(raw: unknown): PlaybookPayload {
	const source = (raw ?? {}) as Record<string, unknown>;
	const counterpart = source.counterpart_type;

	return {
		counterpart_type:
			counterpart === "supplier" || counterpart === "friend" ? counterpart : "customer",
		executive_summary: asString(source.executive_summary) || null,
		short_tags: Array.isArray(source.short_tags)
			? source.short_tags.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
			: [],
		personality_spectrums: normalizeSpectrums(source.personality_spectrums),
		small_talk_playbook: normalizeSmallTalk(source.small_talk_playbook),
		profile: normalizeItems(source.profile),
		business_value: normalizeItems(source.business_value),
		pain_points: normalizeItems(source.pain_points),
		sweet_spots: normalizeItems(source.sweet_spots),
		taboos: normalizeItems(source.taboos),
	};
}

/** 详情页用：每个 kind 只取最新一条 applied，playbook 一律归一化成 V2 形状。 */
export async function latestInsights(contactId: string): Promise<RelationshipInsight[]> {
	const rows = await db()
		.select()
		.from(relationshipInsights)
		.where(
			and(
				eq(relationshipInsights.contactId, contactId),
				eq(relationshipInsights.status, "applied"),
			),
		)
		.orderBy(desc(relationshipInsights.createdAt));

	const seen = new Set<string>();
	const result: RelationshipInsight[] = [];

	for (const row of rows) {
		if (seen.has(row.kind)) continue;
		seen.add(row.kind);

		result.push({
			id: row.id,
			contactId: row.contactId,
			kind: row.kind as InsightKind,
			payload:
				row.kind === "playbook"
					? normalizePlaybookPayload(row.payload)
					: (row.payload as RelationshipInsight["payload"]),
			evidence: parseEvidence(row.evidence),
			source: row.source,
			status: factStatus(row.status),
			createdAt: row.createdAt,
		});
	}

	return result;
}

/** 副驾驶与研究上下文用：把最新洞察压成几行提示词文本。 */
export function describeInsights(insights: RelationshipInsight[]): string[] {
	const lines: string[] = [];

	for (const insight of insights) {
		if (insight.kind === "playbook") {
			const payload = insight.payload as PlaybookPayload;

			if (payload.executive_summary) {
				lines.push(`人物白描：${payload.executive_summary}`);
			}

			const tags = payload.short_tags.length
				? payload.short_tags
				: payload.profile.map((item) => item.title);
			if (tags.length) {
				lines.push(`短标签：${tags.join("、")}`);
			}

			if (payload.personality_spectrums) {
				const s = payload.personality_spectrums;
				lines.push(
					`性格光谱（0=左极，100=右极）：严谨vs灵活 ${s.rigor_vs_flexibility.score}/100（${s.rigor_vs_flexibility.note}）；公事vs人情 ${s.transactional_vs_relational.score}/100（${s.transactional_vs_relational.note}）；直觉vs实证 ${s.trust_mechanism.score}/100（${s.trust_mechanism.note}）`,
				);
			}

			const deep = (label: string, items: PlaybookPayload["business_value"]) => {
				if (!items.length) return null;
				const parts = items.map((item) => {
					const confidence = item.confidence !== null ? `（置信${item.confidence}%）` : "";
					const attribution = item.attribution ? `——${item.attribution}` : "";
					return `${item.title}${confidence}${attribution}`;
				});
				return `${label}=${parts.join("；")}`;
			};

			const sections = [
				deep("商务潜力", payload.business_value),
				deep("痛点与防御", payload.pain_points),
				deep("沟通爽点", payload.sweet_spots),
				deep("沟通雷区", payload.taboos),
			].filter(Boolean);
			if (sections.length) {
				lines.push(`深度洞察：${sections.join("；")}`);
			}

			const smallTalk = payload.small_talk_playbook;
			if (smallTalk) {
				const hooks = smallTalk.personal_hooks
					.map((hook) => `[${hook.category}] ${hook.detail}（原话：「${hook.quote}」）`)
					.join("；");
				const ice = smallTalk.ready_to_use_icebreaker;
				const icebreaker = ice ? `；现成破冰话术：${ice.zh}${ice.en ? ` / ${ice.en}` : ""}` : "";
				lines.push(
					`家常弹药库：配比建议=${smallTalk.strategy_advice || "无"}；弹药=${hooks || "无"}${icebreaker}`,
				);
			}
		}

		if (insight.kind === "dual_track") {
			const payload = insight.payload as z.infer<typeof dualTrackSchema>;
			const side = (label: string, item: z.infer<typeof dualTrackSideSchema>) =>
				`${label}=${item.level}${item.score !== null ? `(${item.score})` : ""}：${item.note}`;

			lines.push(
				`双轨温度：${side("事务健康度", payload.transaction_health)}；${side("个人信任", payload.personal_trust)}`,
			);
		}
	}

	return lines;
}
