import { guarded } from "../utils/guard";
import { mcpOverview } from "../utils/mcp";

export default defineEventHandler(() =>
	guarded(async () => {
		return mcpOverview();
	}),
);
