import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { closeDb } from "../server/utils/db";
import { acceptFieldDef, proposeField } from "../server/utils/fields";
import { recordFact } from "../server/utils/facts";
import { evidence, resetDatabase } from "./helpers";

const projectRoot = resolve(import.meta.dir, "..");
const entry = resolve(projectRoot, ".output", "server", "index.mjs");
const PORT = 3214;
const base = `http://127.0.0.1:${PORT}`;
const built = existsSync(entry);

let server: ChildProcess | null = null;
let companyId = "";
let linkedContactId = "";
let looseContactId = "";

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

type Payload = Record<string, unknown>;

async function call(path: string, init?: RequestInit): Promise<{ status: number; payload: Payload }> {
	const response = await fetch(`${base}${path}`, init);

	return { status: response.status, payload: (await response.json()) as Payload };
}

function post(path: string, body: unknown) {
	return call(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

type Row = Record<string, unknown>;

async function list(path: string): Promise<{ items: Row[]; total: number }> {
	const { payload } = await call(path);

	return { items: (payload.items as Row[]) ?? [], total: Number(payload.total ?? 0) };
}

beforeAll(async () => {
	if (!built) return;

	await resetDatabase();

	server = spawn(process.execPath, [entry], {
		cwd: projectRoot,
		env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", ZAI_API_KEY: "" },
		stdio: ["ignore", "pipe", "pipe"],
	});

	await waitForServer();

	const company = await post("/api/companies", {
		name: "示例科技",
		industry: "软件",
		cooperationRole: "客户",
	});
	companyId = ((company.payload.company as Row).id as string) ?? "";

	const linked = await post("/api/contacts", {
		firstName: "王小明",
		title: "产品经理",
		email: "wang@example.com",
		wechatId: "wangxm",
		businessRole: "决策人",
		companyId,
	});
	linkedContactId = ((linked.payload.contact as Row).id as string) ?? "";

	const loose = await post("/api/contacts", { firstName: "李小华" });
	looseContactId = ((loose.payload.contact as Row).id as string) ?? "";

	// 造一个自定义字段并写入一条已生效的值，验证它会跟着列表一起返回。
	const proposed = await proposeField({
		scope: "contact",
		label: "预算周期",
		sampleValue: null,
		sampleRef: null,
		evidence: [evidence()],
	});
	await acceptFieldDef(proposed.def.id);
	await recordFact({
		contactId: linkedContactId,
		field: "预算周期",
		value: "每年 Q4 重签",
		evidence: [evidence()],
		source: "agent",
	});

	await closeDb();
}, 60000);

afterAll(async () => {
	if (server) {
		server.kill();
		await Bun.sleep(500);
	}

	await closeDb();
});

describe.skipIf(!built)("列表字段：跨表列与自定义字段跟着列表一起返回", () => {
	test("联系人列表带公司名，默认不依赖职位/邮箱/微信号", async () => {
		const { items } = await list("/api/contacts?q=王小明");

		expect(items).toHaveLength(1);
		expect(items[0].companyName).toBe("示例科技");
		expect(items[0].companyId).toBe(companyId);
		expect(items[0].businessRole).toBe("决策人");
		expect(typeof items[0].updatedAt).toBe("number");
	});

	test("自定义字段的已生效值直接进列表行的 facts", async () => {
		const { items } = await list("/api/contacts?q=王小明");

		expect(items[0].facts).toBeTypeOf("object");
		expect((items[0].facts as Row)["预算周期"]).toBe("每年 Q4 重签");
	});

	test("待确认的值不进列表 facts，字段本身也不被改写", async () => {
		// 王小明的邮箱是人工填的：智能体再提一个不同的值只会变成 proposed。
		const proposed = await recordFact({
			contactId: linkedContactId,
			field: "email",
			value: "new-wang@example.com",
			evidence: [evidence()],
			source: "agent",
		});

		expect(proposed.status).toBe("proposed");

		const { items } = await list("/api/contacts?q=王小明");
		expect((items[0].facts as Row).email).toBeUndefined();
		expect(items[0].email).toBe("wang@example.com");

		await closeDb();
	});

	test("没挂公司的联系人 companyName 为 null，不是空字符串", async () => {
		const { items } = await list("/api/contacts?q=李小华");

		expect(items).toHaveLength(1);
		expect(items[0].id).toBe(looseContactId);
		expect(items[0].companyName).toBeNull();
	});

	test("公司列表带在跑的联系人数", async () => {
		const { items } = await list("/api/companies?q=示例科技");

		expect(items).toHaveLength(1);
		expect(items[0].contactCount).toBe(1);
		expect(items[0].cooperationRole).toBe("客户");
	});
});

describe.skipIf(!built)("列表删除：归档后移出列表，可原样恢复", () => {
	test("删除联系人后默认列表看不到，加 archived=true 能看到", async () => {
		const removed = await call(`/api/contacts/${linkedContactId}`, { method: "DELETE" });
		expect(removed.status).toBe(200);
		expect(removed.payload.archived).toBe(true);

		const active = await list("/api/contacts");
		expect(active.items.some((row) => row.id === linkedContactId)).toBe(false);

		const archived = await list("/api/contacts?archived=true");
		expect(archived.items.some((row) => row.id === linkedContactId)).toBe(true);
	});

	test("归档的联系人不计入公司的联系人数", async () => {
		const { items } = await list("/api/companies?q=示例科技");
		expect(items[0].contactCount).toBe(0);
	});

	test("恢复后回到默认列表，公司联系人数跟着回来", async () => {
		const restored = await post(`/api/contacts/${linkedContactId}/restore`, {});
		expect(restored.status).toBe(200);
		expect(restored.payload.restored).toBe(true);

		const active = await list("/api/contacts");
		expect(active.items.some((row) => row.id === linkedContactId)).toBe(true);
		expect(active.total).toBe(2);

		const { items } = await list("/api/companies?q=示例科技");
		expect(items[0].contactCount).toBe(1);
	});

	test("公司同样能归档与恢复", async () => {
		const removed = await call(`/api/companies/${companyId}`, { method: "DELETE" });
		expect(removed.payload.archived).toBe(true);
		expect((await list("/api/companies")).items.some((row) => row.id === companyId)).toBe(false);
		expect((await list("/api/companies?archived=true")).items.some((row) => row.id === companyId)).toBe(
			true,
		);

		const restored = await post(`/api/companies/${companyId}/restore`, {});
		expect(restored.payload.restored).toBe(true);
		expect((await list("/api/companies")).items.some((row) => row.id === companyId)).toBe(true);
	});

	test("对不存在的记录恢复会返回 404，而不是静默成功", async () => {
		const missing = await post("/api/contacts/not-a-real-id/restore", {});
		expect(missing.status).toBe(404);
	});
});

describe.skipIf(!built)("只读留底：系统写的活动类型不接受手工创建", () => {
	test("chat_log / stage_change 被拒，普通备注照常", async () => {
		const chatLog = await post("/api/activities", { kind: "chat_log", title: "伪造留底" });
		expect(chatLog.status).toBe(400);

		const stage = await post("/api/activities", { kind: "stage_change", title: "伪造阶段变更" });
		expect(stage.status).toBe(400);

		const note = await post("/api/activities", { kind: "note", title: "正常备注" });
		expect(note.status).toBe(200);
	});
});

describe.skipIf(!built)("MCP 接入提示：平台把两个 server 的可用配置算出来", () => {
	test("返回两个方向相反的 server", async () => {
		const { status, payload } = await call("/api/mcp");
		expect(status).toBe(200);

		const servers = payload.servers as Row[];
		expect(servers).toHaveLength(2);
		expect(servers.map((item) => item.id)).toEqual(["wechat", "crm"]);
		expect(servers[0].direction).toBe("读");
		expect(servers[1].direction).toBe("写");
	});

	test("每段客户端配置都是可以直接粘贴的合法 JSON", async () => {
		const { payload } = await call("/api/mcp");

		for (const server of payload.servers as Row[]) {
			const snippets = server.snippets as Row[];
			expect(snippets.length).toBeGreaterThan(0);

			for (const snippet of snippets) {
				const parsed = JSON.parse(String(snippet.json)) as {
					mcpServers: Record<string, { command?: string; args?: string[] }>;
				};
				const entryConfig = parsed.mcpServers[String(server.id)];

				expect(entryConfig).toBeDefined();

				if (entryConfig.command === "node") {
					const entryPath = entryConfig.args?.[0] ?? "";
					expect(entryPath).toContain(String(server.packageDir).slice(0, 8));
					expect(entryPath.endsWith("index.js")).toBe(true);
					expect(existsSync(entryPath)).toBe(true);
				}
			}
		}
	});

	test("平台地址取自当前进程，端口与运行中的实例一致", async () => {
		const { payload } = await call("/api/mcp");

		expect(String(payload.platformBaseUrl)).toBe(`http://127.0.0.1:${PORT}`);
	});

	test("必填项没配时给出可执行的阻塞原因", async () => {
		const { payload } = await call("/api/mcp");
		const wechat = (payload.servers as Row[])[0];
		const env = wechat.env as Row[];
		const exportDir = env.find((item) => item.key === "WECHAT_EXPORT_DIR");

		expect(exportDir).toBeDefined();

		if (exportDir?.source === "missing") {
			expect((wechat.blockers as string[]).join()).toContain("WECHAT_EXPORT_DIR");
			expect(wechat.ready).toBe(false);
		} else {
			expect(wechat.ready).toBe(true);
		}
	});
});
