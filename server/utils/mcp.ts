import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseEnvFile } from "dotenv";
import type { McpEnvItem, McpOverview, McpServerInfo } from "../../app/types/domain";
import { env } from "./env";

/**
 * 平台内的 MCP Server 接入提示。
 *
 * 只做「读盘 + 拼装」，不启动任何子进程：把写侧 MCP 包（mcp-crm）的现状和
 * 可直接粘贴的客户端配置算出来交给界面。路径以进程工作目录为基准，与 env.ts 读 .env 的口径一致。
 */

const ROOT = process.cwd();

function readEnvFile(path: string): Record<string, string> {
	if (!existsSync(path)) return {};

	try {
		return parseEnvFile(readFileSync(path, "utf8"));
	} catch {
		// .env 写坏了不该让整页打不开，按「没配」处理，blockers 会提示。
		return {};
	}
}

function envItem(
	fileEnv: Record<string, string>,
	input: { key: string; required: boolean; description: string; fallback?: string },
): McpEnvItem {
	const { fallback, ...meta } = input;
	const fromProcess = process.env[input.key]?.trim();
	const fromFile = fileEnv[input.key]?.trim();

	if (fromProcess) {
		return { ...meta, value: fromProcess, source: "env" };
	}

	if (fromFile) {
		return { ...meta, value: fromFile, source: "file" };
	}

	return { ...meta, value: fallback ?? "", source: "missing" };
}

/** Windows 下 JSON.stringify 会把反斜杠转义，正好是客户端配置需要的写法。 */
function stdioSnippet(input: {
	id: string;
	entry: string;
	env: Record<string, string>;
}): string {
	return JSON.stringify(
		{
			mcpServers: {
				[input.id]: {
					command: "node",
					args: [input.entry],
					env: input.env,
				},
			},
		},
		null,
		2,
	);
}

function httpSnippet(id: string, port: string): string {
	return JSON.stringify(
		{ mcpServers: { [id]: { type: "http", url: `http://127.0.0.1:${port}/mcp` } } },
		null,
		2,
	);
}

const STDIO_WHERE =
	"通用 mcpServers 结构：Cursor 的 .cursor/mcp.json（或 ~/.cursor/mcp.json）、WorkBuddy 的连接器配置、Claude Desktop 的 %APPDATA%\\Claude\\claude_desktop_config.json 都填这一段。";

export function platformBaseUrl(): string {
	// 走 env() 而不是直接读 process.env：它保证 .env 已被加载，并带上默认值。
	const current = env();

	// 0.0.0.0 不是客户端能连的地址，换成回环。
	const reachable =
		current.host === "0.0.0.0" || current.host === "::" || current.host === ""
			? "127.0.0.1"
			: current.host;

	return `http://${reachable}:${current.port}`;
}

function crmServer(): McpServerInfo {
	const packageDir = resolve(ROOT, "mcp-crm");
	const entry = resolve(packageDir, "dist", "index.js");
	const envFile = resolve(packageDir, ".env");
	const fileEnv = readEnvFile(envFile);
	const baseUrl = platformBaseUrl();

	const crmBaseUrl = envItem(fileEnv, {
		key: "CRM_BASE_URL",
		required: true,
		description: "CRM 平台地址，正常情况下就是本平台。",
		fallback: baseUrl,
	});
	const maxText = envItem(fileEnv, {
		key: "CRM_MAX_TEXT_LENGTH",
		required: false,
		description: "单次转发的聊天记录字符上限，默认 50000，超限会被拒绝并要求分批。",
	});
	const httpPort = envItem(fileEnv, {
		key: "MCP_HTTP_PORT",
		required: false,
		description: "留空 = 只用 stdio（推荐）。填端口后改为 Streamable HTTP，只绑定 127.0.0.1。",
	});

	const entryExists = existsSync(entry);
	const blockers: string[] = [];

	if (!existsSync(packageDir)) blockers.push("没有找到 mcp-crm 目录，确认它与平台在同一层目录下。");
	if (!entryExists) blockers.push("尚未编译：先在该目录执行 bun install 与 bun run build，产出 dist/index.js。");
	if (crmBaseUrl.source === "missing") blockers.push("未配置 CRM_BASE_URL，服务启动会直接以非零码退出。");

	const port = httpPort.source === "missing" ? "3940" : httpPort.value;

	// 缺配置时把平台自身地址填进去，人只要粘贴就行。
	const effectiveBaseUrl = crmBaseUrl.source === "missing" ? baseUrl : crmBaseUrl.value;

	return {
		id: "crm",
		name: "mcp-crm",
		direction: "写",
		summary:
			"客户端把聊天记录原文交给平台：调 import_wechat_chat 转发到 /api/intake，由平台侧智能体抽取联系人、公司与字段并建档。本包不解析、不改写、不落盘。",
		packageDir,
		entry,
		entryExists,
		envFile,
		envFileExists: existsSync(envFile),
		env: [crmBaseUrl, maxText, httpPort],
		tools: [
			{ name: "import_wechat_chat", summary: "把一段聊天记录原样转发给平台，返回新建的联系人与公司。" },
			{ name: "intake_status", summary: "探测平台是否在线、智能体是否可用。写入失败前先调它定位问题。" },
		],
		snippets: [
			{
				label: "stdio 模式（推荐）",
				where: STDIO_WHERE,
				json: stdioSnippet({
					id: "crm",
					entry,
					env: { CRM_BASE_URL: effectiveBaseUrl },
				}),
			},
			{
				label: `Streamable HTTP 模式（先用 MCP_HTTP_PORT=${port} node dist/index.js 起服务）`,
				where: "客户端只支持远程连接时用这一段；服务只监听 127.0.0.1。",
				json: httpSnippet("crm", port),
			},
		],
		buildCommands: [
			`cd "${packageDir}"`,
			"bun install",
			"bun run build",
		],
		blockers,
		ready: blockers.length === 0,
	};
}

export function mcpOverview(): McpOverview {
	return {
		platformBaseUrl: platformBaseUrl(),
		root: ROOT,
		servers: [crmServer()],
		notes: [
			"mcp-crm 是写侧：客户端把聊天记录交给平台，由智能体抽取联系人、公司与字段并建档。",
			"默认 stdio 传输，无需开放端口；只有远程客户端接入时才用 Streamable HTTP。",
			"平台侧写入同时提供 HTTP 入口 POST /api/intake，供不方便装 MCP 客户端的场景直连。",
			"HTTP 模式只绑定 127.0.0.1。要对公网暴露必须先前置反向代理并加认证。",
		],
	};
}
