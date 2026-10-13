import { listQuery } from "../utils/validate";
import { companyOptions } from "../utils/companies";
import { guarded } from "../utils/guard";

export default defineEventHandler((event) =>
	guarded(async () => {
		const query = listQuery.parse(getQuery(event));

		return { items: await companyOptions(query.q) };
	}),
);
