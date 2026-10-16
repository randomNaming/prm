import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { agentTasks } from "../server/db/schema";
import { db, closeDb } from "../server/utils/db";
import { CONFIG } from "../server/utils/config";
import {
	claimDueTask,
	finishTask,
	queueStatus,
	recoverExpiredLeases,
	scheduleRecheck,
} from "../server/utils/queue";
import { runQueueTick, resetQueueRateLimit } from "../server/utils/worker";
import { contactFixture, resetDatabase, useAgentEnv } from "./helpers";

const now = () => Date.now();

beforeEach(async () => {
	await resetDatabase();
	resetQueueRateLimit();
});

afterAll(async () => {
	await closeDb();
});

async function taskRow(id: string) {
	const [row] = await db().select().from(agentTasks).where(eq(agentTasks.id, id));

	return row;
}

async function insertTask(input: {
	kind?: string;
	status?: string;
	runAt?: number;
	attempts?: number;
	leaseUntil?: number | null;
	targetId?: string | null;
}) {
	const { agentTasks: table } = await import("../server/db/schema");
	const { newId } = await import("../server/utils/ids");
	const id = newId();

	await db()
		.insert(table)
		.values({
			id,
			kind: input.kind ?? "research_contact",
			targetType: "contact",
			targetId: input.targetId ?? null,
			payload: { reason: "测试" },
			status: input.status ?? "pending",
			priority: 100,
			attempts: input.attempts ?? 0,
			maxAttempts: CONFIG.queue.maxAttempts,
			leaseUntil: input.leaseUntil ?? null,
			runAt: input.runAt ?? now(),
			createdAt: now(),
		});

	return id;
}

describe("FR-5 行即队列：认领与租约", () => {
	test("到期的 pending 行被认领为 running，attempts 加一，租约落在未来", async () => {
		const id = await insertTask({ runAt: now() - 1000 });

		const claimed = await claimDueTask();

		expect(claimed?.id).toBe(id);
		expect(claimed?.attempts).toBe(1);

		const row = await taskRow(id);
		expect(row.status).toBe("running");
		expect(Number(row.attempts)).toBe(1);
		expect(Number(row.leaseUntil)).toBeGreaterThan(now());
	});

	test("未到期的行不被认领", async () => {
		await insertTask({ runAt: now() + CONFIG.time.minuteMs });

		expect(await claimDueTask()).toBeNull();
	});

	test("租约过期的 running 行回到 pending（进程重启后重跑）", async () => {
		const id = await insertTask({ status: "running", leaseUntil: now() - 1000 });

		const recovered = await recoverExpiredLeases();

		expect(recovered).toBe(1);

		const row = await taskRow(id);
		expect(row.status).toBe("pending");
	});

	test("租约未过期的 running 行保持不动", async () => {
		const id = await insertTask({ status: "running", leaseUntil: now() + CONFIG.time.minuteMs });

		expect(await recoverExpiredLeases()).toBe(0);
		expect((await taskRow(id)).status).toBe("running");
	});
});

describe("FR-5 失败重试上限", () => {
	test("失败后回到 pending，attempts 达到上限后置 failed 且 error 有内容", async () => {
		const id = await insertTask({ attempts: 0 });

		await finishTask(id, "第一次失败");
		let row = await taskRow(id);
		expect(row.status).toBe("pending");
		expect(row.error).toBe("第一次失败");

		await db().update(agentTasks).set({ attempts: 3 }).where(eq(agentTasks.id, id));
		await finishTask(id, "第三次失败");

		row = await taskRow(id);
		expect(row.status).toBe("failed");
		expect(row.error).toBe("第三次失败");
		expect(row.finishedAt).not.toBeNull();
	});

	test("排队状态统计区分 pending / running / failed，未来排期不算进行中", async () => {
		await insertTask({});
		await insertTask({ status: "running", leaseUntil: now() + 1000 });
		await insertTask({ status: "failed" });
		// 未来的复查预约：已排期但没到期，不该被算成「进行中」。
		await insertTask({ runAt: now() + 5 * 24 * 60 * 60 * 1000 });

		const status = await queueStatus();

		expect(status).toEqual({ pending: 1, running: 1, failed: 1, scheduled: 1 });
	});
});

describe("FR-5 复查到期自动重新入队", () => {
	test("recheck 到期后本轮生成研究任务，自身完成", async () => {
		useAgentEnv("http://127.0.0.1:1");
		const contact = await contactFixture();
		const taskId = await scheduleRecheck({ contactId: contact.id, days: 7, reason: "7 天后再看" });

		const scheduled = await taskRow(taskId);
		expect(scheduled.kind).toBe("recheck");
		expect(Number(scheduled.runAt)).toBeGreaterThan(now() + 6 * CONFIG.time.dayMs);

		await db().update(agentTasks).set({ runAt: now() - 1 }).where(eq(agentTasks.id, taskId));

		const result = await runQueueTick();

		expect(result.recovered).toBe(0);
		expect((await taskRow(taskId)).status).toBe("done");

		const rows = await db().select().from(agentTasks).where(eq(agentTasks.targetId, contact.id));
		const research = rows.find((row) => row.kind === "research_contact");
		expect(research).toBeDefined();
		expect(research?.status).toBe("pending");
	});

	test("智能体未配置时不认领任务，队列保持 pending", async () => {
		delete process.env.ZAI_API_KEY;
		const id = await insertTask({});

		const result = await runQueueTick();

		expect(result.claimed).toBe(0);
		expect(result.reason).toContain("ZAI_API_KEY");
		expect((await taskRow(id)).status).toBe("pending");
	});
});

describe("FR-5 研究任务失败进入重试", () => {
	test("模型端点失败时任务回到 pending 并记录 error", async () => {
		const { startStubModel } = await import("./stub-model");
		const stub = await startStubModel([{ status: 500 }]);
		useAgentEnv(stub.baseUrl);

		const contact = await contactFixture();
		const { enqueueResearch } = await import("../server/utils/queue");
		const id = await enqueueResearch(contact.id, "测试失败重试");

		const result = await runQueueTick();
		await stub.close();

		expect(result.failed).toBe(1);

		const row = await taskRow(id ?? "");
		expect(row.status).toBe("pending");
		expect(String(row.error).length).toBeGreaterThan(0);
		expect(Number(row.attempts)).toBe(1);
	});
});
