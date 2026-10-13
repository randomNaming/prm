import { z } from "zod";
import { recordCompanyFact } from "../utils/company-facts";
import { recordFact } from "../utils/facts";
import { acceptFieldDef, dismissFieldDef } from "../utils/fields";
import { guarded, notFound } from "../utils/guard";

const body = z.object({
	id: z.string().trim().min(1).max(36),
	action: z.enum(["accept", "reject"]),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const input = body.parse(await readBody(event));

		if (input.action === "reject") {
			const rejected = await dismissFieldDef(input.id);
			if (!rejected.ok) throw notFound(rejected.reason);

			return { ok: true, reason: rejected.reason };
		}

		const accepted = await acceptFieldDef(input.id);
		if (!accepted.ok || !accepted.def) throw notFound(accepted.reason);

		const def = accepted.def;

		if (!def.sampleValue || !def.sampleRef || !def.evidence || def.evidence.length === 0) {
			return { ok: true, reason: "字段已生效。", valueWritten: false };
		}

		const written =
			def.scope === "company"
				? await recordCompanyFact({
						companyId: def.sampleRef,
						field: def.key,
						value: def.sampleValue,
						evidence: def.evidence,
						source: "human",
					})
				: await recordFact({
						contactId: def.sampleRef,
						field: def.key,
						value: def.sampleValue,
						evidence: def.evidence,
						source: "human",
					});

		return {
			ok: true,
			reason: written.stored ? "字段已生效，示例值已写入。" : `字段已生效。${written.reason}`,
			valueWritten: written.stored,
		};
	}),
);
