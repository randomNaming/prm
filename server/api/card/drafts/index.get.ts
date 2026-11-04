import { listCardDrafts } from "../../../utils/cards";
import { guarded } from "../../../utils/guard";

/** 待确认草稿列表：App 与 PC 复核读同一份数据。 */
export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method !== "GET") {
			throw createError({ statusCode: 405, statusMessage: "该端点只接受 GET 请求。" });
		}

		const query = getQuery(event);
		const status = typeof query.status === "string" ? query.status : undefined;
		const rawLimit = typeof query.limit === "string" ? Number.parseInt(query.limit, 10) : NaN;

		return {
			ok: true,
			drafts: await listCardDrafts({
				status,
				limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
			}),
		};
	}),
);
