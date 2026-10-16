import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2";
import type { AgentTask } from "../../app/types/domain";
import { agentTasks } from "../db/schema";
import { CONFIG } from "./config";
import { connectionPool, db } from "./db";
import { newId, nowMs } from "./ids";
import { parseTaskPayload } from "./parse";

export const TASK_KINDS = {
	research: CONFIG.queue.researchKind,
	companyResearch: CONFIG.queue.companyResearchKind,
	recheck: CONFIG.queue.recheckKind,
} as const;

export const TASK_STATUS = {
	pending: "pending",
	running: "running",
	done: "done",
	failed: "failed",
	cancelled: "cancelled",
} as const;

export const TARGET_TYPES = {
	contact: "contact",
	company: "company",
} as const;

type TaskRow = RowDataPacket & {
	id: string;
	kind: string;
	target_type: string | null;
	target_id: string | null;
	payload: unknown;
	status: string;
	priority: number;
	attempts: number;
	max_attempts: number;
	run_at: number;
	finished_at: number | null;
	error: string | null;
	created_at: number;
};

function toTask(row: TaskRow): AgentTask {
	return {
		id: row.id,
		kind: row.kind,
		targetType: row.target_type,
		targetId: row.target_id,
		payload: parseTaskPayload(row.payload),
		status: row.status,
		priority: Number(row.priority),
		attempts: Number(row.attempts),
		maxAttempts: Number(row.max_attempts),
		runAt: Number(row.run_at),
		finishedAt: row.finished_at === null ? null : Number(row.finished_at),
		error: row.error,
		createdAt: Number(row.created_at),
	};
}

export async function enqueueAgentTask(input: {
	kind: string;
	targetType: string;
	targetId: string;
	reason: string;
	priority?: number;
}): Promise<string> {
	const existing = await db()
		.select({ id: agentTasks.id })
		.from(agentTasks)
		.where(
			and(
				eq(agentTasks.kind, input.kind),
				eq(agentTasks.targetId, input.targetId),
				inArray(agentTasks.status, [TASK_STATUS.pending, TASK_STATUS.running]),
			),
		)
		.limit(1);

	if (existing.length > 0) return existing[0].id;

	const id = newId();
	const at = nowMs();

	await db().insert(agentTasks).values({
		id,
		kind: input.kind,
		targetType: input.targetType,
		targetId: input.targetId,
		payload: { reason: input.reason },
		status: TASK_STATUS.pending,
		priority: input.priority ?? 100,
		attempts: 0,
		maxAttempts: CONFIG.queue.maxAttempts,
		runAt: at,
		createdAt: at,
	});

	return id;
}

export async function enqueueResearch(contactId: string, reason: string): Promise<string | null> {
	return enqueueAgentTask({
		kind: TASK_KINDS.research,
		targetType: TARGET_TYPES.contact,
		targetId: contactId,
		reason,
	});
}

export async function enqueueCompanyResearch(
	companyId: string,
	reason: string,
): Promise<string | null> {
	return enqueueAgentTask({
		kind: TASK_KINDS.companyResearch,
		targetType: TARGET_TYPES.company,
		targetId: companyId,
		reason,
	});
}

export async function scheduleRecheck(input: {
	contactId: string;
	days: number;
	reason: string;
}): Promise<string> {
	const at = nowMs();
	const runAt = at + input.days * CONFIG.time.dayMs;

	const existing = await db()
		.select({ id: agentTasks.id })
		.from(agentTasks)
		.where(
			and(
				eq(agentTasks.kind, TASK_KINDS.recheck),
				eq(agentTasks.targetId, input.contactId),
				inArray(agentTasks.status, [TASK_STATUS.pending, TASK_STATUS.running]),
			),
		)
		.limit(1);

	if (existing.length > 0) {
		await db()
			.update(agentTasks)
			.set({
				runAt,
				payload: { reason: input.reason, days: input.days },
				status: TASK_STATUS.pending,
				leaseUntil: null,
			})
			.where(eq(agentTasks.id, existing[0].id));

		return existing[0].id;
	}

	const id = newId();

	await db().insert(agentTasks).values({
		id,
		kind: TASK_KINDS.recheck,
		targetType: TARGET_TYPES.contact,
		targetId: input.contactId,
		payload: { reason: input.reason, days: input.days },
		status: TASK_STATUS.pending,
		priority: 50,
		attempts: 0,
		maxAttempts: CONFIG.queue.maxAttempts,
		runAt,
		createdAt: at,
	});

	return id;
}

export async function claimDueTask(): Promise<AgentTask | null> {
	const connection = await connectionPool().getConnection();
	const at = nowMs();

	try {
		await connection.beginTransaction();

		const [rows] = await connection.query<TaskRow[]>(
			`SELECT id, kind, target_type, target_id, payload, status, priority, attempts, max_attempts, run_at, finished_at, error, created_at
			 FROM agent_tasks
			 WHERE status = ? AND run_at <= ?
			 ORDER BY priority DESC, run_at ASC
			 LIMIT 1
			 FOR UPDATE SKIP LOCKED`,
			[TASK_STATUS.pending, at],
		);

		const row = rows[0];
		if (!row) {
			await connection.commit();
			return null;
		}

		await connection.query(
			`UPDATE agent_tasks SET status = ?, lease_until = ?, attempts = attempts + 1 WHERE id = ?`,
			[TASK_STATUS.running, at + CONFIG.queue.leaseMs, row.id],
		);

		await connection.commit();

		return toTask({ ...row, status: TASK_STATUS.running, attempts: row.attempts + 1 });
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

export async function finishTask(taskId: string, error?: string): Promise<void> {
	const at = nowMs();

	// 只收尾还没被人工终止的任务：用户点了「终止」后，迟到的僵尸运行不允许覆盖结果。
	const guard = and(
		eq(agentTasks.id, taskId),
		inArray(agentTasks.status, [TASK_STATUS.pending, TASK_STATUS.running]),
	);

	if (!error) {
		await db()
			.update(agentTasks)
			.set({ status: TASK_STATUS.done, finishedAt: at, error: null, leaseUntil: null })
			.where(guard);

		return;
	}

	const [task] = await db()
		.select({ attempts: agentTasks.attempts, maxAttempts: agentTasks.maxAttempts })
		.from(agentTasks)
		.where(eq(agentTasks.id, taskId))
		.limit(1);

	const exhausted = !task || task.attempts >= task.maxAttempts;

	await db()
		.update(agentTasks)
		.set(
			exhausted
				? { status: TASK_STATUS.failed, finishedAt: at, error, leaseUntil: null }
				: { status: TASK_STATUS.pending, runAt: at + CONFIG.queue.leaseMs, error, leaseUntil: null },
		)
		.where(guard);
}

/**
 * 人工终止：把目标记录上还没跑完的研究任务直接判死。
 * 正在进程内运行的那一次会被请求级超时兜住（见 CONFIG.agent.requestTimeoutMs），
 * 它结束后 finishTask 会因状态已 cancelled 而跳过，不会复活。
 */
export async function cancelAgentTasks(input: {
	targetType: string;
	targetId: string;
}): Promise<number> {
	const result = await db()
		.update(agentTasks)
		.set({
			status: TASK_STATUS.cancelled,
			finishedAt: nowMs(),
			error: "人工终止。",
			leaseUntil: null,
		})
		.where(
			and(
				eq(agentTasks.targetType, input.targetType),
				eq(agentTasks.targetId, input.targetId),
				inArray(agentTasks.status, [TASK_STATUS.pending, TASK_STATUS.running]),
			),
		);

	return result[0].affectedRows;
}

export async function recoverExpiredLeases(): Promise<number> {
	const at = nowMs();

	const result = await db()
		.update(agentTasks)
		.set({ status: TASK_STATUS.pending, leaseUntil: null })
		.where(
			and(
				eq(agentTasks.status, TASK_STATUS.running),
				sql`${agentTasks.leaseUntil} IS NOT NULL AND ${agentTasks.leaseUntil} < ${at}`,
			),
		);

	return result[0].affectedRows;
}

export async function queueStatus(): Promise<{
	pending: number;
	running: number;
	failed: number;
	/** 已排期但还没到期的任务数（主要是未来的复查预约）——不算「进行中」。 */
	scheduled: number;
}> {
	const rows = await db()
		.select({
			status: agentTasks.status,
			runAt: agentTasks.runAt,
			total: count(),
		})
		.from(agentTasks)
		.where(inArray(agentTasks.status, [TASK_STATUS.pending, TASK_STATUS.running, TASK_STATUS.failed]))
		.groupBy(agentTasks.status, agentTasks.runAt);

	const at = nowMs();
	const totals = { pending: 0, running: 0, failed: 0, scheduled: 0 };

	for (const row of rows) {
		const total = Number(row.total);

		if (row.status === TASK_STATUS.running) totals.running += total;
		else if (row.status === TASK_STATUS.failed) totals.failed += total;
		else if (row.runAt !== null && Number(row.runAt) > at) totals.scheduled += total;
		else totals.pending += total;
	}

	return totals;
}

export async function recentTasks(limit: number): Promise<AgentTask[]> {
	const connection = await connectionPool().getConnection();

	try {
		const [rows] = await connection.query<TaskRow[]>(
			`SELECT id, kind, target_type, target_id, payload, status, priority, attempts, max_attempts, run_at, finished_at, error, created_at
			 FROM agent_tasks ORDER BY created_at DESC LIMIT ?`,
			[limit],
		);

		return rows.map(toTask);
	} finally {
		connection.release();
	}
}
