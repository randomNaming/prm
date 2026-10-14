import { board } from "../utils/board";
import { guarded } from "../utils/guard";

/** 首页四象限看板：任务、商机、客户标记三类混排，象限自动推断 + 手工拖拽覆盖。 */
export default defineEventHandler(() =>
	guarded(async () => {
		return board();
	}),
);
