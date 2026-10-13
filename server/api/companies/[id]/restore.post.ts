import { restoreCompany } from "../../../utils/companies";
import { guarded, notFound } from "../../../utils/guard";

/** 把已归档的公司放回列表。列表页「显示已归档」里的恢复按钮走这里。 */
export default defineEventHandler((event) =>
	guarded(async () => {
		const id = getRouterParam(event, "id");
		if (!id) throw notFound("公司不存在。");

		const restored = await restoreCompany(id);
		if (!restored) throw notFound("公司不存在。");

		return { restored: true };
	}),
);
