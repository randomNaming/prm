import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { InsightKind, RelationshipInsight } from "../../app/types/domain";
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
 */

const insightItemSchema = z.object({
	text: z.string().trim().min(1).max(400),
	quote: z.string().trim().min(1).max(1000),
	time: z.string().trim().max(32).nullish().transform((value) => value ?? null),
});

const playbookSchema = z.object({
	counterpart_type: z.enum(["customer", "supplier", "friend"]),
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

/** 详情页用：每个 kind 只取最新一条 applied。 */
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
			payload: row.payload as RelationshipInsight["payload"],
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
			const payload = insight.payload as z.infer<typeof playbookSchema>;
			const section = (items: { text: string }[]) =>
				items.map((item) => item.text).join("；") || "无";
			const profile = (payload as { profile?: { text: string }[] }).profile ?? [];
			const businessValue = (payload as { business_value?: { text: string }[] }).business_value ?? [];

			lines.push(
				`客户洞察（对象类型：${payload.counterpart_type}）：画像标签=${profile.map((item) => item.text).join("、") || "无"}；商务价值=${businessValue.map((item) => item.text).join("；") || "无"}；痛点=${section(payload.pain_points)}；爽点=${section(payload.sweet_spots)}；雷区=${section(payload.taboos)}`,
			);
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
