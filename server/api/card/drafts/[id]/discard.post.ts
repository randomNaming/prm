import { discardCardDraft } from "../../../../utils/cards";
import { guarded } from "../../../../utils/guard";

/** 丢弃草稿（可选端点）：pending → discarded，不碰 contacts。 */
export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method !== "POST") {
			throw createError({ statusCode: 405, statusMessage: "该端点只接受 POST 请求。" });
		}

		const id = getRouterParam(event, "id") ?? "";
		const body = (await readBody(event).catch(() => null)) as { note?: unknown } | null;
		const note = typeof body?.note === "string" ? body.note : null;

		return discardCardDraft(id, note);
	}),
);
