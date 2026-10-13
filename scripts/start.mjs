#!/usr/bin/env node
/**
 * 一键启动器：环境预检 → 必要时构建 → 启动服务。
 *
 * 为什么中文提示集中在这个文件里，而不是写在 start.cmd：
 * cmd.exe 按控制台代码页（中文 Windows 是 936/GBK）逐行读批处理文件，
 * 里面用 UTF-8 存的中文会被解成乱码，然后当成命令去执行 ——
 * 这正是旧版 start.cmd 满屏「不是内部或外部命令」的原因。
 * 批处理因此保持纯 ASCII，中文交给 Node 输出。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = resolve(ROOT, ".env");
const ENV_EXAMPLE = resolve(ROOT, ".env.example");
const ENTRY = resolve(ROOT, ".output", "server", "index.mjs");
const NUXT_BIN = resolve(ROOT, "node_modules", "nuxt", "bin", "nuxt.mjs");
const MIN_NODE_MAJOR = 20;
const DB_PROBE_TIMEOUT_MS = 3000;

const problems = [];

function say(line = "") {
	process.stdout.write(`${line}\n`);
}

/** 只解析 KEY=VALUE，不引依赖：node_modules 还没装时这段也得能跑。 */
function readEnvFile(path) {
	const values = {};

	for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;

		const eq = line.indexOf("=");
		if (eq === -1) continue;

		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();

		if (
			(value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
			(value.startsWith("'") && value.endsWith("'") && value.length > 1)
		) {
			value = value.slice(1, -1);
		}

		values[key] = value;
	}

	return values;
}

function mark(ok) {
	return ok ? "✓" : "✗";
}

function probeTcp(host, port, timeoutMs) {
	return new Promise((done) => {
		const socket = createConnection({ host, port });
		let settled = false;

		const finish = (result) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			done(result);
		};

		socket.setTimeout(timeoutMs);
		socket.once("connect", () => finish({ ok: true }));
		socket.once("timeout", () => finish({ ok: false, reason: "连接超时" }));
		socket.once("error", (error) => finish({ ok: false, reason: error.code ?? error.message }));
	});
}

function describeDb(databaseUrl) {
	try {
		const url = new URL(databaseUrl);
		const port = url.port || "3306";

		return {
			ok: true,
			host: url.hostname,
			port,
			masked: `${url.protocol}//${url.username}${url.password ? ":****" : ""}@${url.host}${url.pathname}`,
		};
	} catch {
		return { ok: false, host: "", port: "", masked: databaseUrl };
	}
}

function dbHint(reason) {
	const hints = {
		ECONNREFUSED: "端口没人监听：MySQL 没启动，或端口写错了。",
		ETIMEDOUT: "网络不通：确认这台机器能访问该内网地址。",
		ENOTFOUND: "主机名解析失败：检查 DATABASE_URL 里的主机。",
		EHOSTUNREACH: "主机不可达：确认与 NAS / 数据库同一网段。",
	};

	return hints[reason] ?? "确认数据库在线、地址与端口无误。";
}

function section(index, total, title) {
	say(`[${index}/${total}] ${title}`);
}

/** 构建产物不存在时跑一次 nuxt build。返回是否成功。 */
function runBuild() {
	if (!existsSync(NUXT_BIN)) {
		say(`  ${mark(false)} 找不到 ${NUXT_BIN}`);
		say("      先在项目目录执行 bun install（或 npm install）。");
		return false;
	}

	say("  正在构建，第一次会慢一些……");
	say();

	const result = spawnSync(process.execPath, [NUXT_BIN, "build"], {
		cwd: ROOT,
		stdio: "inherit",
		env: childEnv(),
	});

	say();

	if (result.status !== 0) {
		say(`  ${mark(false)} 构建失败（退出码 ${result.status ?? "未知"}）。`);
		return false;
	}

	return true;
}

/**
 * 清掉 NODE_OPTIONS：沙箱注入的删除 shim 会拦住 nuxt 的资源清理。
 * 设 CRM_KEEP_NODE_OPTIONS=1 可以保留自己的 NODE_OPTIONS。
 */
function childEnv() {
	const env = { ...process.env };

	if (!env.CRM_KEEP_NODE_OPTIONS) env.NODE_OPTIONS = "";

	return env;
}

async function main() {
	say("============================================");
	say("  极简 CRM · 启动检查");
	say("============================================");
	say();

	// ---- [1/3] 环境 ----
	section(1, 3, "环境检查");

	const major = Number(process.versions.node.split(".")[0]);
	const nodeOk = major >= MIN_NODE_MAJOR;

	say(`  ${mark(nodeOk)} Node.js ${process.version}`);
	if (!nodeOk) problems.push(`Node.js 需要 ${MIN_NODE_MAJOR} 或更高，当前 ${process.version}。`);

	if (!existsSync(ENV_FILE)) {
		say(`  ${mark(false)} 没有找到 .env`);
		say(`      在项目目录执行：copy .env.example .env`);
		say(`      然后至少填好 DATABASE_URL（可选填 ZAI_API_KEY）。`);
		say(`      模板：${ENV_EXAMPLE}`);

		return 1;
	}

	say(`  ${mark(true)} .env 已找到`);

	const fileEnv = readEnvFile(ENV_FILE);

	// 进程环境变量优先于 .env，与 node --env-file 的取值规则一致。
	const pick = (key) => process.env[key]?.trim() || fileEnv[key]?.trim() || "";

	const databaseUrl = pick("DATABASE_URL");
	if (!databaseUrl) {
		say(`  ${mark(false)} DATABASE_URL 为空`);
		say("      打开 .env，填上形如 mysql://用户:密码@主机:3306/crm_mini 的连接串。");

		return 1;
	}

	const db = describeDb(databaseUrl);
	say(`  ${mark(db.ok)} DATABASE_URL ${db.masked}`);

	if (!db.ok) {
		say("      连接串格式无法解析，应为 mysql://用户:密码@主机:端口/库名。");

		return 1;
	}

	const agentKey = pick("ZAI_API_KEY");
	say(
		`  ${mark(Boolean(agentKey))} ZAI_API_KEY ${agentKey ? "已配置" : "未配置：对话与后台研究停用，其余功能正常"}`,
	);

	const probe = await probeTcp(db.host, Number(db.port), DB_PROBE_TIMEOUT_MS);
	say(
		`  ${mark(probe.ok)} MySQL ${db.host}:${db.port} ${probe.ok ? "可达" : `不可达（${probe.reason}）`}`,
	);

	if (!probe.ok) {
		say(`      ${dbHint(probe.reason)}`);
		say("      仍会继续启动：数据库不可用时页面能打开，但读写会报错。");
	}

	say();

	// ---- [2/3] 构建产物 ----
	section(2, 3, "构建产物");

	if (existsSync(ENTRY)) {
		say("  ✓ 已有 .output/server/index.mjs，跳过构建");
		say("      要重新构建：删掉 .output 目录后再运行本脚本。");
	} else if (!runBuild()) {
		return 1;
	} else {
		say("  ✓ 构建完成");
	}

	if (!existsSync(ENTRY)) {
		say(`  ${mark(false)} 构建结束但仍找不到 ${ENTRY}`);

		return 1;
	}

	say();

	// ---- [3/3] 启动 ----
	section(3, 3, "启动服务");

	const host = pick("HOST") || "127.0.0.1";
	const port = pick("PORT") || "3000";
	const browserHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

	say(`  监听 ${host}:${port}`);
	say(`  访问 http://${browserHost}:${port}/`);

	if (host === "0.0.0.0" || host === "::") {
		say("  ⚠ 当前绑定了所有网卡，同网段的机器都能访问。仅本机使用请把 .env 的 HOST 改回 127.0.0.1。");
	}

	say("  停止服务：按 Ctrl+C");
	say();

	const server = spawnSync(process.execPath, ["--env-file=.env", ENTRY], {
		cwd: ROOT,
		stdio: "inherit",
		env: childEnv(),
	});

	if (server.error) {
		say(`${mark(false)} 启动失败：${server.error.message}`);

		return 1;
	}

	if (server.signal) {
		say();
		say(`服务已被 ${server.signal} 停止。`);

		return 0;
	}

	if (server.status !== 0) {
		say();
		say(`${mark(false)} 服务退出，退出码 ${server.status}。上方日志里通常有原因。`);

		return server.status ?? 1;
	}

	return 0;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		say();
		say(`启动器自身出错：${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
