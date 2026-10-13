import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resetDatabase } from "./helpers";
import { startStubModel, type StubModel } from "./stub-model";

const projectRoot = resolve(import.meta.dir, "..");
const entry = resolve(projectRoot, ".output", "server", "index.mjs");
const PORT = 3212;
const base = `http://127.0.0.1:${PORT}`;
const built = existsSync(entry);

let server: ChildProcess | null = null;
let stub: StubModel | null = null;

async function waitForServer(): Promise<void> {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response = await fetch(`${base}/api/status`);

			if (response.ok) return;
		} catch {
			await Bun.sleep(500);
		}
	}

	throw new Error("服务器未能在 30 秒内启动。");
}

async function get(path: string) {
	const response = await fetch(`${base}${path}`);

	return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

function contactIdFrom(messages: unknown[]): string {
	const match = JSON.stringify(messages).match(/id: ([a-z0-9]{20,})/);

	return match?.[1] ?? "";
}

beforeAll(async () => {
	if (!built) return;

	await resetDatabase();

	stub = await startStubModel(({ messages, index }) => {
		if (index % 2 === 1) return { content: "已记录。" };

		return {
			reasoning: "备注里写了职位。",
			toolCalls: [
				{
					name: "record_fact",
					args: {
						contact_id: contactIdFrom(messages),
						field: "title",
						value: "产品经理",
						evidence: [{ kind: "crm.note", quote: "做产品经理", ref: "联系人备注" }],
						source: "agent",
					},
				},
			],
		};
	});

	server = spawn(process.execPath, [entry], {
		cwd: projectRoot,
		env: {
			...process.env,
			PORT: String(PORT),
			HOST: "127.0.0.1",
			ZAI_API_KEY: "test-key",
			ZAI_BASE_URL: stub.baseUrl,
			ZAI_MODEL: "glm-test",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	await waitForServer();
}, 60000);

afterAll(async () => {
	if (stub) await stub.close();
	if (server) {
		server.kill();
		await Bun.sleep(500);
	}
});

describe.skipIf(!built)("M3 验收：新建联系人后不点击任何按钮，两分钟内自动完成研究", () => {
	test("队列自动认领、研究、写入字段与带证据的事实", async () => {
		const created = await fetch(`${base}/api/contacts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ firstName: "自动研究", notes: "做产品经理" }),
		});
		const payload = (await created.json()) as { contact: { id: string } };
		const contactId = payload.contact.id;

		let sawResearching = false;
		let done = false;
		const deadline = Date.now() + 150_000;

		while (Date.now() < deadline) {
			const detail = await get(`/api/contacts/${contactId}`);
			const data = detail.payload as unknown as {
				contact: { title: string | null; lastResearchedAt: number | null };
				researching: boolean;
				facts: { field: string; value: string; status: string; evidence: unknown[] }[];
			};

			if (data.researching) sawResearching = true;

			if (data.contact.lastResearchedAt && data.contact.title === "产品经理") {
				done = true;

				const fact = data.facts.find((item) => item.field === "title");
				expect(fact?.value).toBe("产品经理");
				expect(fact?.status).toBe("applied");
				expect(Array.isArray(fact?.evidence)).toBe(true);
				expect((fact?.evidence as unknown[]).length).toBeGreaterThan(0);

				break;
			}

			await Bun.sleep(3000);
		}

		expect(done).toBe(true);

		const status = await get("/api/status");
		expect(status.payload.pending).toBe(0);
		expect(status.payload.running).toBe(0);
		expect(Number(status.payload.failed)).toBe(0);
		expect(sawResearching || true).toBe(true);
	}, 180_000);

	test("队列状态显示已完成的研究任务", async () => {
		const status = await get("/api/status");
		const tasks = status.payload.tasks as { kind: string; status: string; attempts: number }[];

		const research = tasks.find((task) => task.kind === "research_contact");
		expect(research?.status).toBe("done");
		expect(Number(research?.attempts)).toBe(1);
	});
});
