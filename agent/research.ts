import { eq } from "drizzle-orm";
import { generateText, stepCountIs } from "ai";
import { contacts } from "../server/db/schema";
import { CONFIG } from "../server/utils/config";
import { db } from "../server/utils/db";
import { latestArchiveOriginal } from "../server/utils/intake-archive";
import { nowMs } from "../server/utils/ids";
import { agentModel } from "./model";
import { RESEARCH_SYSTEM, companyContext, companyPreamble, contactContext, contactPreamble } from "./prompts";
import { crmTools } from "./tools";

export type ResearchOutcome = {
	summary: string;
	facts: number;
	activities: number;
};

export async function runCompanyResearch(
	companyId: string,
	reason: string,
): Promise<ResearchOutcome> {
	const context = await companyContext(companyId);
	if (!context) throw new Error(`公司 ${companyId} 不存在，研究无法进行。`);

	const result = await generateText({
		model: agentModel(),
		system: [RESEARCH_SYSTEM, companyPreamble(context)].join("\n\n"),
		prompt: [
			`现在研究这家公司：${context.company.name}。`,
			reason ? `入队原因：${reason}` : "",
			"只依据上面的 CRM 库内数据。能推断出的公司字段用 record_company_fact 写入并给出 evidence；有值得记录的事用 create_activity（记得带 company_id）。",
			"库里推不出新东西时，用 create_activity 记一条「本轮无新增证据」即可。做完就停，不要写计划。",
		]
			.filter(Boolean)
			.join("\n"),
		tools: crmTools(),
		stopWhen: stepCountIs(CONFIG.agent.maxSteps),
		maxOutputTokens: CONFIG.agent.maxOutputTokens,
		maxRetries: CONFIG.agent.maxRetries,
	});

	const calls = result.steps.flatMap((step) => step.toolCalls ?? []);

	return {
		summary: result.text.trim().slice(0, 500),
		facts: calls.filter((call) => call.toolName === "record_company_fact").length,
		activities: calls.filter((call) => call.toolName === "create_activity").length,
	};
}

export async function runResearch(contactId: string, reason: string): Promise<ResearchOutcome> {
	const context = await contactContext(contactId);
	if (!context) throw new Error(`联系人 ${contactId} 不存在，研究无法进行。`);

	// 有聊天留底时，把最近一次的原文一并交给研究，按三层冰山补做分析 ——
	// 原文只在导入时进过模型，这一步让「重新研究」也能吃到大段历史，不必从 MCP 重导。
	const archive = await latestArchiveOriginal(contactId);

	const name = `${context.contact.firstName}${context.contact.lastName ?? ""}`;
	const result = await generateText({
		model: agentModel(),
		system: [RESEARCH_SYSTEM, contactPreamble(context)].join("\n\n"),
		prompt: [
			`现在研究这位联系人：${name}。`,
			reason ? `入队原因：${reason}` : "",
			"只依据上面的 CRM 库内数据。能推断出的字段用 record_fact 写入并给出 evidence；有值得记录的事用 create_activity。",
			archive
				? [
						"另外，下面是这位联系人最近一次导入的聊天原文。请按系统提示的【聊天原文重析】规范补做三层分析：",
						`（留底：${archive.title}）`,
						"---- 历史聊天原文开始 ----",
						archive.text.slice(0, 60000),
						"---- 历史聊天原文结束 ----",
					].join("\n")
				: "",
			archive ? "" : "库里推不出新东西时，用 create_activity 记一条「本轮无新增证据」即可。",
			"做完就停，不要写计划。",
		]
			.filter(Boolean)
			.join("\n"),
		tools: crmTools(),
		stopWhen: stepCountIs(CONFIG.agent.maxSteps),
		maxOutputTokens: CONFIG.agent.maxOutputTokens,
		maxRetries: CONFIG.agent.maxRetries,
	});

	const calls = result.steps.flatMap((step) => step.toolCalls ?? []);

	await db().update(contacts).set({ lastResearchedAt: nowMs() }).where(eq(contacts.id, contactId));

	return {
		summary: result.text.trim().slice(0, 500),
		facts: calls.filter((call) => call.toolName === "record_fact").length,
		activities: calls.filter((call) => call.toolName === "create_activity").length,
	};
}
