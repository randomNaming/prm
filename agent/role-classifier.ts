import { generateText } from "ai";
import { z } from "zod";
import { CONFIG } from "../server/utils/config";
import { agentCapability } from "../server/utils/env";
import { extractJsonObject } from "./json";
import { agentModel } from "./model";

export type RoleScope = "contact" | "company";

export type RoleDecision =
	| { kind: "existing"; value: string; reason: string }
	| { kind: "other"; reason: string }
	| { kind: "new"; value: string; reason: string }
	| { kind: "unavailable"; reason: string };

export type RoleClassifyInput = {
	scope: RoleScope;
	label: string;
	text: string;
	options: string[];
};

export type RoleClassifier = {
	name: string;
	classify: (input: RoleClassifyInput) => Promise<RoleDecision>;
};

const decisionSchema = z.object({
	decision: z.enum(["existing", "other", "new"]),
	value: z.string().nullish(),
	reason: z.string().nullish(),
});

const SCOPE_RULE: Record<RoleScope, string> = {
	contact: "这次判断的是「这个人本人」。资料里写的是公司的属性（例如源头厂家、生产销售、承接定制），不要算到这个人的头上，选 other。",
	company: "这次判断的是「这家公司」。资料里写的是个人的岗位或职责（例如负责对接、管技术），不要算到公司头上，选 other。",
};

function instruction(input: RoleClassifyInput): string {
	return [
		`你要判断一段资料描述的主体，在这位使用者的生意里扮演什么角色。字段名：${input.label}。`,
		`现有标签：${input.options.join("、")}。`,
		SCOPE_RULE[input.scope],
		"只输出一个 JSON 对象，不要输出别的字：",
		'{"decision":"existing|other|new","value":"标签原文或新标签","reason":"一句话依据"}',
		"规则：",
		"1. 资料明确支持某个现有标签时，decision 用 existing，value 必须是现有标签的原文。",
		"2. 资料明确写出了一个现有标签都不覆盖的角色（例如「渠道商」「代工厂」），decision 用 new，value 写资料里的那个说法。",
		"3. 资料没有提到角色，或者不足以判断，decision 用 other，value 留空。",
		"不要猜。资料没写就选 other。",
		"",
		"资料：",
		input.text,
	].join("\n");
}

export const llmRoleClassifier: RoleClassifier = {
	name: "llm",
	async classify(input) {
		const capability = agentCapability();

		if (!capability.enabled) {
			return { kind: "unavailable", reason: capability.reason };
		}

		try {
			const result = await generateText({
				model: agentModel(),
				prompt: instruction(input),
				maxOutputTokens: CONFIG.agent.maxOutputTokens,
		maxRetries: CONFIG.agent.maxRetries,
			});

			const parsed = decisionSchema.safeParse(extractJsonObject(result.text));

			if (!parsed.success) {
				return { kind: "other", reason: "分类器没有给出可用的判断。" };
			}

			const value = (parsed.data.value ?? "").trim();
			const reason = (parsed.data.reason ?? "").trim();

			if (parsed.data.decision === "existing") {
				const matched = input.options.find((option) => option === value);

				return matched
					? { kind: "existing", value: matched, reason }
					: { kind: "other", reason: "分类器给的标签不在选项表里。" };
			}

			if (parsed.data.decision === "new") {
				return value
					? { kind: "new", value, reason }
					: { kind: "other", reason: "分类器没有给出新标签。" };
			}

			return { kind: "other", reason: reason || "资料不足以判断角色。" };
		} catch (error) {
			return {
				kind: "unavailable",
				reason: error instanceof Error ? error.message : "分类器调用失败。",
			};
		}
	},
};

export function roleClassifier(): RoleClassifier {
	return llmRoleClassifier;
}
