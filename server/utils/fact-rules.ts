import type { Evidence } from "../../app/types/domain";

const HOST_ALIASES = new Map([["twitter.com", "x.com"]]);

export function canonicalValue(value: string): string {
	const text = value.trim().replace(/\s+/g, " ").toLowerCase();
	const url = asWebUrl(text);

	if (!url) return text;

	const host = url.host.replace(/^www\./, "");
	const path = url.pathname.replace(/\/+$/, "");

	return `${HOST_ALIASES.get(host) ?? host}${path}`;
}

export function sameValue(a: string, b: string): boolean {
	return canonicalValue(a) === canonicalValue(b);
}

function asWebUrl(value: string): URL | null {
	try {
		const url = new URL(value);

		return url.protocol === "http:" || url.protocol === "https:" ? url : null;
	} catch {
		return null;
	}
}

export function describeEvidence(evidence: Evidence[]): string {
	return evidence
		.map((item) => `${item.kind}${item.ref ? ` (${item.ref})` : ""}：「${item.quote}」`)
		.join("；");
}

export type ExistingFact = {
	value: string;
	status: string;
};

export type FactOutcome =
	| { kind: "refused"; reason: string }
	| { kind: "applied"; reason: string }
	| { kind: "proposed"; reason: string };

export function decideFact(input: {
	label: string;
	value: string;
	evidence: Evidence[];
	existing: ExistingFact[];
	currentValue: string | null;
	currentIsHuman: boolean;
}): FactOutcome {
	const { label, value, evidence, existing, currentValue, currentIsHuman } = input;

	if (!value) return { kind: "refused", reason: `${label}：值为空，不写入。` };

	if (evidence.length === 0) {
		return { kind: "refused", reason: `${label}：没有一手来源，不写入。` };
	}

	const dismissed = existing.find(
		(fact) => fact.status === "dismissed" && sameValue(fact.value, value),
	);
	if (dismissed) return { kind: "refused", reason: `${label}：这个值已被拒绝过，不再提。` };

	const appliedFact = existing.find((fact) => fact.status === "applied");

	if (appliedFact && sameValue(appliedFact.value, value)) {
		return { kind: "refused", reason: `${label}：记录里已经是这个值。` };
	}

	// 字段现值已经同文（人工填的列值也算）：不再生成建议。
	// 过去的洞在这里——列里人工填了「买家」，事实表里没有对应行，
	// 智能体再提一次「买家」就变成待确认建议，接受后详情页渲染出两行一样的。
	if (currentValue && sameValue(currentValue, value)) {
		return { kind: "refused", reason: `${label}：记录里已经是这个值，不再重复建议。` };
	}

	const proposed = existing.find(
		(fact) => fact.status === "proposed" && sameValue(fact.value, value),
	);
	if (proposed) return { kind: "refused", reason: `${label}：这个值已在待确认列表里。` };

	if (!currentValue || !currentIsHuman) {
		// 覆盖智能体自己写的旧值时，明确说这是认知刷新（修正），不是含糊的「直接写入」。
		const corrected =
			appliedFact && currentValue
				? `修正旧值「${appliedFact.value}」为「${value}」`
				: "字段为空，已直接写入";

		return {
			kind: "applied",
			reason: `${label}：${corrected}。证据：${describeEvidence(evidence)}`,
		};
	}

	return {
		kind: "proposed",
		reason: `${label}：字段已有人工值「${currentValue}」，已存为建议，等你在界面上确认。`,
	};
}
