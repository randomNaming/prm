import { z } from "zod";
import { FIELD_SCOPES } from "../../app/types/domain";
import { listFieldDefs } from "../utils/fields";
import { guarded } from "../utils/guard";

const query = z.object({
	scope: z.enum(FIELD_SCOPES).optional(),
	status: z.enum(["active", "proposed", "dismissed"]).optional(),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const parsed = query.parse(getQuery(event));

		return { fields: await listFieldDefs(parsed) };
	}),
);
