import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resetDatabase } from "./helpers";

const projectRoot = resolve(import.meta.dir, "..");
const entry = resolve(projectRoot, ".output", "server", "index.mjs");
const PORT = 3213;
const base = `http://127.0.0.1:${PORT}`;
const built = existsSync(entry);

let server: ChildProcess | null = null;
let contactId = "";
let dealId = "";
let companyId = "";

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

async function html(path: string): Promise<string> {
	const response = await fetch(`${base}${path}`);
	expect(response.status).toBe(200);

	return response.text();
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

	const company = await fetch(`${base}/api/companies`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "示例科技", industry: "软件" }),
	}).then((response) => response.json() as Promise<{ company: { id: string } }>);
	companyId = company.company.id;

	const contact = await fetch(`${base}/api/contacts`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			firstName: "王小明",
			title: "产品经理",
			email: "wang@example.com",
			wechatId: "wangxm",
			companyId,
			notes: "倾向私有化部署",
		}),
	}).then((response) => response.json() as Promise<{ contact: { id: string } }>);
	contactId = contact.contact.id;

	const deal = await fetch(`${base}/api/deals`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: "示例科技 · 首单",
			companyId,
			contactId,
			stage: "方案报价",
			expectedCloseDate: "2026-12-01",
		}),
	}).then((response) => response.json() as Promise<{ deal: { id: string } }>);
	dealId = deal.deal.id;

	await fetch(`${base}/api/activities`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			kind: "note",
			title: "电话沟通：确认预算",
			contactId,
			dealId,
		}),
	});
}, 60000);

afterAll(async () => {
	if (server) {
		server.kill();
		await Bun.sleep(500);
	}
});

describe.skipIf(!built)("页面渲染：简体中文、无金额、可导航", () => {
	test("首页三块与快捷按钮", async () => {
		const page = await html("/");

		expect(page).toContain("推进中的商机");
		expect(page).toContain("已逾期任务");
		expect(page).toContain("近期活动");
		expect(page).toContain("新建联系人");
		expect(page).toContain("示例科技 · 首单");
		expect(page.includes("金额")).toBe(false);
	});

	test("联系人列表与详情：基本信息、建议区、活动时间线、Agent 标签页", async () => {
		const list = await html("/contacts");
		expect(list).toContain("王小明");
		expect(list).toContain("按姓名、邮箱、微信号搜索");

		const detail = await html(`/contacts/${contactId}`);
		expect(detail).toContain("基本信息");
		expect(detail).toContain("字段建议");
		expect(detail).toContain("活动时间线");
		expect(detail).toContain("Agent");
		expect(detail).toContain("产品经理");
		expect(detail).toContain("wang@example.com");
		expect(detail).toContain("倾向私有化部署");
		expect(detail).toContain("地址");
		expect(detail.includes("金额")).toBe(false);
	});

	test("公司列表与详情", async () => {
		const list = await html("/companies");
		expect(list).toContain("示例科技");

		const detail = await html(`/companies/${companyId}`);
		expect(detail).toContain("公司联系人");
		expect(detail).toContain("王小明");
		expect(detail).toContain("相关商机");
		expect(detail).toContain("公司资料");
		expect(detail).toContain("公司地址");
		expect(detail).toContain("字段建议");
	});

	test("商机列表与详情：六阶段可切换，页面无金额字段", async () => {
		const list = await html("/deals");
		expect(list).toContain("示例科技 · 首单");
		expect(list).toContain("方案报价");
		expect(list.includes("金额")).toBe(false);

		const detail = await html(`/deals/${dealId}`);
		expect(detail).toContain("阶段历史");
		expect(detail).toContain("预计成交日");
		expect(detail).toContain("2026-12-01");
		expect(detail.includes("金额")).toBe(false);
		expect(detail.includes("amount")).toBe(false);
	});

	test("全局对话页：搜索区与对话区都在，且说明数据边界外的用法", async () => {
		const page = await html("/chat");

		expect(page).toContain("全局对话");
		expect(page).toContain("按子串查库");
		expect(page).toContain("用中文提问");
	});

	test("导航项齐全且没有登录入口", async () => {
		const page = await html("/");

		for (const label of ["首页", "联系人", "公司", "商机", "智能体"]) {
			expect(page).toContain(label);
		}

		expect(page.includes("登录")).toBe(false);
		expect(page.includes("注册")).toBe(false);
		expect(page.includes("退出")).toBe(false);
	});
});
