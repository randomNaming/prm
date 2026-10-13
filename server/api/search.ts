import { z } from "zod";
import { CONFIG } from "../utils/config";
import { guarded } from "../utils/guard";
import { searchCrm } from "../utils/search";

const query = z.object({
	q: z.string().trim().max(CONFIG.lists.maxSearchLength).default(""),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const { q } = query.parse(getQuery(event));

		return { query: q, hits: await searchCrm(q, CONFIG.lists.pageSize * 2) };
	}),
);
