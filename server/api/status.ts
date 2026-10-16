import { inArray } from "drizzle-orm";
import { agentCapability } from "../utils/env";
import { guarded } from "../utils/guard";
import { companies, contacts } from "../db/schema";
import { db } from "../utils/db";
import { queueStatus, recentTasks } from "../utils/queue";

export default defineEventHandler(() =>
	guarded(async () => {
		const capability = agentCapability();
		const status = await queueStatus();
		const tasks = await recentTasks(10);

		// 给任务补上目标名字，顶栏的队列管理弹层才能说人话（「研究联系人：Michael Wake」）。
		const contactIds = [...new Set(tasks.map((task) => task.targetType === "contact" ? task.targetId : null).filter((id): id is string => Boolean(id)))];
		const companyIds = [...new Set(tasks.map((task) => task.targetType === "company" ? task.targetId : null).filter((id): id is string => Boolean(id)))];

		const nameById = new Map<string, string>();

		if (contactIds.length > 0) {
			const rows = await db()
				.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
				.from(contacts)
				.where(inArray(contacts.id, contactIds));
			for (const row of rows) nameById.set(row.id, `${row.firstName}${row.lastName ?? ""}`);
		}

		if (companyIds.length > 0) {
			const rows = await db()
				.select({ id: companies.id, name: companies.name })
				.from(companies)
				.where(inArray(companies.id, companyIds));
			for (const row of rows) nameById.set(row.id, row.name);
		}

		return {
			...status,
			agentEnabled: capability.enabled,
			agentReason: capability.reason,
			model: capability.model,
			tasks: tasks.map((task) => ({ ...task, targetName: nameById.get(task.targetId ?? "") ?? null })),
		};
	}),
);

