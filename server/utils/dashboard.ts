import type { Dashboard, DashboardDeal, DashboardTask } from "../../app/types/domain";
import { CONFIG } from "./config";
import { recentActivities, overdueTasks } from "./activities";
import { openDeals } from "./deals";
import { contactCompany } from "./contacts";

export async function dashboard(now = Date.now()): Promise<Dashboard> {
	const [deals, tasks, activities] = await Promise.all([
		openDeals(CONFIG.lists.pageSize),
		overdueTasks(now, CONFIG.lists.pageSize),
		recentActivities(CONFIG.lists.recentActivityLimit),
	]);

	const dealRows: DashboardDeal[] = await Promise.all(
		deals.map(async (deal) => {
			const company = await contactCompany(deal.companyId);

			return {
				id: deal.id,
				name: deal.name,
				stage: deal.stage,
				companyName: company?.name ?? null,
				stageChangedAt: deal.stageChangedAt,
				expectedCloseDate: deal.expectedCloseDate,
			};
		}),
	);

	const taskRows: DashboardTask[] = tasks;

	return { deals: dealRows, tasks: taskRows, activities };
}
