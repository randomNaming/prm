import { companyInput } from "../../utils/validate";
import { archiveCompany, companyDetail, updateCompany } from "../../utils/companies";
import { guarded, notFound } from "../../utils/guard";

export default defineEventHandler((event) =>
	guarded(async () => {
		const id = getRouterParam(event, "id");
		if (!id) throw notFound("公司不存在。");

		if (event.method === "PUT") {
			const input = companyInput.parse(await readBody(event));
			const company = await updateCompany(id, input);
			if (!company) throw notFound("公司不存在。");

			return { company };
		}

		if (event.method === "DELETE") {
			const archived = await archiveCompany(id);
			if (!archived) throw notFound("公司不存在或已归档。");

			return { archived: true };
		}

		const detail = await companyDetail(id);
		if (!detail) throw notFound("公司不存在。");

		return detail;
	}),
);
