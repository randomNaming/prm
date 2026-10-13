import { dealInput, listQuery } from "../../utils/validate";
import { createDeal, listDeals, type DealQuery } from "../../utils/deals";
import { DEAL_STAGES } from "../../../app/types/domain";
import { guarded } from "../../utils/guard";
import { z } from "zod";

const stageFilter = z.enum(DEAL_STAGES).optional();

export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method === "POST") {
			const input = dealInput.parse(await readBody(event));

			return { deal: await createDeal(input) };
		}

		const raw = getQuery(event);
		const query: DealQuery = {
			...listQuery.parse(raw),
			stage: stageFilter.parse(raw.stage ?? undefined),
		};

		return listDeals(query);
	}),
);
