import { z } from "zod";
import { BOARD_ITEM_TYPES, BOARD_QUADRANTS } from "../../../app/types/domain";
import { pinItem } from "../../utils/board";
import { badRequest, guarded } from "../../utils/guard";

const pinInput = z.object({
	type: z.enum(BOARD_ITEM_TYPES),
	id: z.string().trim().min(1).max(36),
	quadrant: z.enum(BOARD_QUADRANTS),
	/** 客户端把「系统推断值」一并回传：拖回原位即等于恢复自动，不用再做一个重置按钮。 */
	inferred: z.enum(BOARD_QUADRANTS),
});

/** 把一个事项拖到别的象限。 */
export default defineEventHandler((event) =>
	guarded(async () => {
		const input = pinInput.parse(await readBody(event));
		const result = await pinItem(input);

		if (!result.ok) throw badRequest(result.reason);

		return result;
	}),
);
