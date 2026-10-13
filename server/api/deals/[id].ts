import { z } from "zod";
import { DEAL_STAGES } from "../../../app/types/domain";
import { archiveDeal, changeDealStage, dealDetail, updateDeal } from "../../utils/deals";
import { guarded, notFound } from "../../utils/guard";
import { dealInput } from "../../utils/validate";

const stageBody = z.object({
	action: z.literal("stage"),
	stage: z.enum(DEAL_STAGES),
});

const editBody = z.object({
	action: z.literal("edit"),
	deal: dealInput,
});

const deleteBody = z.object({ action: z.literal("archive") });

const actionBody = z.discriminatedUnion("action", [stageBody, editBody, deleteBody]);

export default defineEventHandler((event) =>
	guarded(async () => {
		const id = getRouterParam(event, "id");
		if (!id) throw notFound("商机不存在。");

		if (event.method === "GET") {
			const detail = await dealDetail(id);
			if (!detail) throw notFound("商机不存在。");

			return detail;
		}

		const body = actionBody.parse(await readBody(event));

		if (body.action === "stage") {
			const deal = await changeDealStage(id, body.stage);
			if (!deal) throw notFound("商机不存在。");

			return { deal };
		}

		if (body.action === "edit") {
			const deal = await updateDeal(id, body.deal);
			if (!deal) throw notFound("商机不存在。");

			return { deal };
		}

		const archived = await archiveDeal(id);
		if (!archived) throw notFound("商机不存在或已归档。");

		return { archived: true };
	}),
);
