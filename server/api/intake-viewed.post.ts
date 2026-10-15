import { z } from "zod";
import { guarded } from "../utils/guard";
import { markIntakeViewed } from "../utils/intake-archive";

const body = z.object({
	contactId: z.string().trim().min(1).max(36),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const { contactId } = body.parse(await readBody(event));

		return { ok: true, marked: await markIntakeViewed(contactId) };
	}),
);
