import { companyInput, listQuery } from "../../utils/validate";
import { createCompany, listCompanies } from "../../utils/companies";
import { agentCapability } from "../../utils/env";
import { guarded } from "../../utils/guard";
import { enqueueCompanyResearch } from "../../utils/queue";

export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method === "POST") {
			const input = companyInput.parse(await readBody(event));
			const company = await createCompany(input);

			if (agentCapability().enabled) {
				await enqueueCompanyResearch(company.id, "新建公司，自动触发一次后台研究。");
			}

			return { company };
		}

		return listCompanies(listQuery.parse(getQuery(event)));
	}),
);
