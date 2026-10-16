import { z } from "zod";
import { guarded, notFound } from "../utils/guard";
import { closePromise } from "../utils/promises";

const body = z.object({
	id: z.string().trim().min(1).max(36),
	action: z.enum(["fulfilled", "cancelled"]),
	note: z.string().trim().max(191).optional(),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const input = body.parse(await readBody(event));

		const result = await closePromise({
			promiseId: input.id,
			action: input.action,
			note: input.note ?? null,
		});

		if (!result.ok) throw notFound(result.reason);

		return { ok: true, reason: result.reason };
	}),
);
