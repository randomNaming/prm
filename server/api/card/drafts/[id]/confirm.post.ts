import { confirmCardDraft } from "../../../../utils/cards";
import { guarded } from "../../../../utils/guard";

/** 确认草稿：人改完的最终值建/并联系人；成功后草稿变 confirmed。 */
export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method !== "POST") {
			throw createError({ statusCode: 405, statusMessage: "该端点只接受 POST 请求。" });
		}

		const id = getRouterParam(event, "id") ?? "";
		const body = await readBody(event).catch(() => null);
		const note = typeof (body as { note?: unknown } | null)?.note === "string" ? (body as { note: string }).note : null;

		return confirmCardDraft(id, body, note);
	}),
);
