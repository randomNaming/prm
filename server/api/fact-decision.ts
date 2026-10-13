import { z } from "zod";
import { acceptCompanyFact, dismissCompanyFact } from "../utils/company-facts";
import { acceptFact, dismissFact } from "../utils/facts";
import { guarded, notFound } from "../utils/guard";

const body = z.object({
	id: z.string().trim().min(1).max(36),
	action: z.enum(["accept", "reject"]),
	subject: z.enum(["contact", "company"]).default("contact"),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const input = body.parse(await readBody(event));

		const result =
			input.subject === "company"
				? input.action === "accept"
					? await acceptCompanyFact(input.id)
					: await dismissCompanyFact(input.id)
				: input.action === "accept"
					? await acceptFact(input.id)
					: await dismissFact(input.id);

		if (!result.ok) throw notFound(result.reason);

		return { ok: true, reason: result.reason };
	}),
);
