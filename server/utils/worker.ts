import { runCompanyResearch, runResearch } from "../../agent/research";
import { getCompany } from "./companies";
import { getContact } from "./contacts";
import { CONFIG } from "./config";
import { agentCapability } from "./env";
import {
	claimDueTask,
	enqueueResearch,
	finishTask,
	recoverExpiredLeases,
	TASK_KINDS,
} from "./queue";

const startedAt: number[] = [];

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let tickStartedAt = 0;

export type TickResult = {
	recovered: number;
	claimed: number;
	done: number;
	failed: number;
	reason: string;
};

function withinRateLimit(now: number): boolean {
	const windowStart = now - CONFIG.queue.rateWindowMs;

	while (startedAt.length > 0 && startedAt[0] < windowStart) startedAt.shift();

	return startedAt.length < CONFIG.queue.rateWindowLimit;
}

export async function runQueueTick(): Promise<TickResult> {
	const result: TickResult = { recovered: 0, claimed: 0, done: 0, failed: 0, reason: "" };

	if (running) {
		result.reason = "上一轮还没跑完，跳过。";

		return result;
	}

	running = true;
	tickStartedAt = Date.now();

	try {
		result.recovered = await recoverExpiredLeases();

		const capability = agentCapability();
		if (!capability.enabled) {
			result.reason = capability.reason;

			return result;
		}

		for (let index = 0; index < CONFIG.queue.batchPerTick; index += 1) {
			if (!withinRateLimit(Date.now())) {
				result.reason = `达到限速上限（每 ${CONFIG.queue.rateWindowMs / CONFIG.time.minuteMs} 分钟 ${CONFIG.queue.rateWindowLimit} 个任务），本轮停止认领。`;
				break;
			}

			const task = await claimDueTask();
			if (!task) break;

			result.claimed += 1;
			startedAt.push(Date.now());

			try {
				if (task.kind === TASK_KINDS.recheck) {
					if (task.targetId) {
						await enqueueResearch(task.targetId, "复查时间到，重新研究。");
					}
					await finishTask(task.id);

					continue;
				}

				if (task.kind === TASK_KINDS.research) {
					if (!task.targetId) throw new Error("研究任务缺少目标联系人。");

					const contact = await getContact(task.targetId);
					if (!contact || contact.archivedAt) {
						await finishTask(task.id);

						continue;
					}

					const outcome = await runResearch(
						task.targetId,
						task.payload?.reason ?? "后台研究任务。",
					);
					result.done += 1;

					await finishTask(task.id);

					if (outcome.facts === 0 && outcome.activities === 0) {
						result.reason = "研究完成，但没有产出事实或活动。";
					}

					continue;
				}

				if (task.kind === TASK_KINDS.companyResearch) {
					if (!task.targetId) throw new Error("研究任务缺少目标公司。");

					const company = await getCompany(task.targetId);
					if (!company || company.archivedAt) {
						await finishTask(task.id);

						continue;
					}

					const outcome = await runCompanyResearch(
						task.targetId,
						task.payload?.reason ?? "后台研究任务。",
					);
					result.done += 1;

					await finishTask(task.id);

					if (outcome.facts === 0 && outcome.activities === 0) {
						result.reason = "公司研究完成，但没有产出事实或活动。";
					}

					continue;
				}

				await finishTask(task.id);
			} catch (error) {
				result.failed += 1;
				await finishTask(task.id, error instanceof Error ? error.message : String(error));
			}
		}
	} finally {
		running = false;
	}

	return result;
}

export function startQueueWorker(): void {
	if (timer) return;

	timer = setInterval(() => {
		// 看门狗：模型请求被远端吊住时，一轮 tick 可能永远不结束，
		// running 标志会把后续所有 tick 全部挡在门外（队列假死）。
		// 超过 stuckTickMs 就强制解锁，让队列恢复认领；原任务靠租约过期回收重试。
		if (running && tickStartedAt > 0 && Date.now() - tickStartedAt > CONFIG.queue.stuckTickMs) {
			running = false;
			console.warn(
				`[crm] 一轮队列 tick 卡了超过 ${Math.round(CONFIG.queue.stuckTickMs / 60000)} 分钟，已强制解锁队列继续认领。`,
			);
		}

		void runQueueTick().catch(() => undefined);
	}, CONFIG.queue.tickMs);

	void runQueueTick().catch(() => undefined);
}

export function stopQueueWorker(): void {
	if (!timer) return;

	clearInterval(timer);
	timer = null;
}

export function resetQueueRateLimit(): void {
	startedAt.length = 0;
}

export function workerRunning(): boolean {
	return timer !== null;
}
