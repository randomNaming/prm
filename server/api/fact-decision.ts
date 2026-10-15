import { z } from "zod";
import {
	acceptCompanyFact,
	dismissCompanyFact,
	revertCompanyFact,
} from "../utils/company-facts";
import { acceptFact, dismissFact, revertFact } from "../utils/facts";
import { guarded, notFound } from "../utils/guard";

const body = z.object({
	id: z.string().trim().min(1).max(36),
	action: z.enum(["accept", "reject", "revert"]),
	subject: z.enum(["contact", "company"]).default("contact"),
});

type Decision = { id: string; action: z.infer<typeof body>["action"] };

async function decideContactFact(input: Decision) {
	if (input.action === "accept") return acceptFact(input.id);
	if (input.action === "revert") return revertFact(input.id);

	return dismissFact(input.id);
}

async function decideCompanyFact(input: Decision) {
	if (input.action === "accept") return acceptCompanyFact(input.id);
	if (input.action === "revert") return revertCompanyFact(input.id);

	return dismissCompanyFact(input.id);
}

export default defineEventHandler((event) =>
	guarded(async () => {
		const input = body.parse(await readBody(event));

		const result =
			input.subject === "company"
				? await decideCompanyFact(input)
				: await decideContactFact(input);

		if (!result.ok) throw notFound(result.reason);

		return { ok: true, reason: result.reason };
	}),
);
