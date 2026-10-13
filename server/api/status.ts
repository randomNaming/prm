import { agentCapability } from "../utils/env";
import { guarded } from "../utils/guard";
import { queueStatus, recentTasks } from "../utils/queue";

export default defineEventHandler(() =>
	guarded(async () => {
		const capability = agentCapability();
		const status = await queueStatus();

		return {
			...status,
			agentEnabled: capability.enabled,
			agentReason: capability.reason,
			model: capability.model,
			tasks: await recentTasks(10),
		};
	}),
);
