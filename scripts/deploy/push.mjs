#!/usr/bin/env node
/**
 * 本地构建 + 推送到云服务器。
 *
 * 为什么不在服务器上构建：那台机器内存不足以跑 Nuxt 构建（实测在 element-plus
 * transform 阶段就被 OOM 杀掉，腾出 MySQL 容器后仍然被杀）。所以构建放本地，
 * 服务器只接收 .output 并重启进程，全程不装 bun、不装构建依赖。
 *
 * 用法：
 *   node scripts/deploy/push.mjs                       # 默认 root@<SERVER_PROD_URL 里的主机>
 *   node scripts/deploy/push.mjs --host 1.2.3.4 --user root
 *   node scripts/deploy/push.mjs --skip-check          # 跳过迁移一致性检查
 *
 * 前置：
 *   - 本地已 `git push origin main`（脚本要求本地 HEAD 与 origin/main 一致）
 *   - 本地到服务器已配好 SSH 公钥登录（BatchMode，不敲密码）
 *   - 服务器仓库已在 /www/wwwroot/prm，.env 已写好，systemd 服务 prm 已存在
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : fallback;
};

const deployPath = arg("--path", "/www/wwwroot/prm");
const service = arg("--service", "prm");
const healthUrl = arg("--health", "http://127.0.0.1:3100/");
const skipCheck = argv.includes("--skip-check");

function fail(message) {
	console.error(`\n错误：${message}`);
	process.exit(1);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** 从 .env.db.local 的 SERVER_PROD_URL 里取服务器地址，避免再维护一份配置。 */
function readServerEntry() {
	const file = join(root, ".env.db.local");
	if (!existsSync(file)) return {};

	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const text = line.trim();
		if (!text || text.startsWith("#")) continue;

		const index = text.indexOf("=");
		if (index < 0 || text.slice(0, index).trim() !== "SERVER_PROD_URL") continue;

		try {
			const url = new URL(text.slice(index + 1).trim());
			return { host: url.hostname, url: url.toString() };
		} catch {
			return {};
		}
	}

	return {};
}

const serverEntry = readServerEntry();
const host = arg("--host", process.env.DEPLOY_HOST || serverEntry.host || "");
const user = arg("--user", process.env.DEPLOY_USER || "root");

if (!host) {
	fail(
		"不知道服务器地址。用 --host 指定，或在 .env.db.local 里填好 SERVER_PROD_URL（脚本会取其中的主机名）。",
	);
}

const sshTarget = `${user}@${host}`;
const sshBase = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		stdio: options.stdio ?? "inherit",
		encoding: "utf8",
	});

	if (options.allowFail) return result;
	if (result.status !== 0) fail(options.hint ?? `${command} 执行失败（退出码 ${result.status}）`);

	return result;
}

function runCapture(command, args) {
	return spawnSync(command, args, { cwd: root, encoding: "utf8" });
}

(async () => {
	console.log(`目标：${sshTarget}  目录：${deployPath}  服务：${service}\n`);

	// ---- 1. SSH 连通性 ----
	const sshProbe = runCapture("ssh", [...sshBase, sshTarget, "echo ok"]);
	if (sshProbe.status !== 0) {
		fail(
			[
				`SSH 连不上 ${sshTarget}。`,
				"确认：① 服务器 SSH 端口放通；② 本机公钥已加入服务器的 ~/.ssh/authorized_keys。",
				`可先手动验证：ssh ${sshTarget} echo ok`,
				String(sshProbe.stderr || "").trim(),
			]
				.filter(Boolean)
				.join("\n"),
		);
	}

	// ---- 2. 代码是否已推送 ----
	const head = runCapture("git", ["rev-parse", "HEAD"]);
	run("git", ["fetch", "origin", "main"], { stdio: "ignore" });
	const remoteHead = runCapture("git", ["rev-parse", "origin/main"]);

	if (head.status !== 0 || remoteHead.status !== 0) {
		fail("读不到 git 提交信息，确认仓库完整且 remote origin 存在。");
	}

	// 服务器只接受已推送的代码：产物与服务器上的仓库必须对应同一个提交
	if (head.stdout.trim() !== remoteHead.stdout.trim()) {
		fail("本地 HEAD 与 origin/main 不一致。先 `git push origin main`，再执行部署。");
	}

	const commit = head.stdout.trim();
	const shortCommit = commit.slice(0, 7);
	console.log(`提交：${shortCommit}\n`);

	// ---- 3. 本地构建 ----
	const hasBun = runCapture("bun", ["--version"]).status === 0;
	const runner = hasBun ? "bun" : "npm";

	console.log(`构建（${runner}）……`);
	if (!existsSync(join(root, "node_modules"))) {
		run(runner, ["install"], { hint: "依赖安装失败。" });
	}
	run(runner, ["run", "build"], { hint: "本地构建失败，没有推送任何东西。" });

	if (!existsSync(join(root, ".output", "server", "index.mjs"))) {
		fail("构建结束但找不到 .output/server/index.mjs。");
	}

	// ---- 4. 打包并传输 ----
	const tempDir = mkdtempSync(join(tmpdir(), "prm-deploy-"));
	const archive = join(tempDir, "output.tgz");

	console.log("\n打包 .output ……");
	run("tar", ["-czf", archive, ".output"], { hint: "打包失败：系统里有 tar 吗？" });

	console.log("上传……");
	run("scp", [...sshBase, "-q", archive, `${sshTarget}:/tmp/prm-output.tgz`], {
		hint: "上传失败。",
	});

	// 服务器侧：先对齐仓库（迁移文件、脚本要靠它），再整体替换 .output
	const remoteCommand = [
		`cd ${deployPath}`,
		`git fetch --prune origin main`,
		`git reset --hard ${commit}`,
		`rm -rf .output`,
		`tar -xzf /tmp/prm-output.tgz`,
		`rm -f /tmp/prm-output.tgz`,
	].join(" && ");

	console.log("服务器上替换产物……");
	run("ssh", [...sshBase, sshTarget, remoteCommand], { hint: "服务器上解包失败。" });

	rmSync(tempDir, { recursive: true, force: true });

	// ---- 5. 重启并健康检查 ----
	console.log("\n重启服务……");
	run("ssh", [...sshBase, sshTarget, `systemctl restart ${service}`], {
		hint: `重启失败。检查服务是否存在：systemctl status ${service}`,
	});

	let healthy = false;
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const probe = runCapture("ssh", [
			...sshBase,
			sshTarget,
			`curl -fsS -o /dev/null --max-time 2 ${healthUrl}`,
		]);

		if (probe.status === 0) {
			healthy = true;
			break;
		}

		await sleep(1000);
	}

	if (!healthy) {
		console.log(`\n服务没在 30 秒内响应 ${healthUrl}，产物已上传但进程可能没起来。`);
		console.log(`排查：ssh ${sshTarget} "journalctl -u ${service} -n 80 --no-pager"`);
		process.exit(1);
	}

	console.log(`\n部署完成：${shortCommit}`);

	// ---- 6. 结构一致性（只在本地比对，不在服务器上执行任何迁移）----
	if (skipCheck) return;

	if (!serverEntry.url) {
		console.log("\n（.env.db.local 里没有 SERVER_PROD_URL，跳过迁移一致性检查）");
		return;
	}

	const check = spawnSync(process.execPath, ["scripts/migrate.mjs", "--check"], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, DATABASE_URL: serverEntry.url },
	});

	const output = `${check.stdout || ""}${check.stderr || ""}`.trim();

	if (check.status === 0) {
		console.log(`\n${output}`);
		return;
	}

	console.log("\n⚠ 正式库结构与新代码不一致，相关页面可能因缺列报错。");
	console.log(output);

	// 迁移永远不隐式执行：加 --migrate 才算明确要求
	const runMigration = argv.includes("--migrate");

	if (!runMigration) {
		console.log("\n本次没有执行迁移。确认已备份正式库后，加 --migrate 重跑本脚本，");
		console.log("或在本地执行：DATABASE_URL=<服务器连接串> node scripts/migrate.mjs --confirm-prod");
		process.exitCode = 2;
		return;
	}

	console.log("\n执行正式库迁移（--confirm-prod）……");
	const migrate = spawnSync(process.execPath, ["scripts/migrate.mjs", "--confirm-prod"], {
		cwd: root,
		stdio: "inherit",
		env: { ...process.env, DATABASE_URL: serverEntry.url },
	});

	if (migrate.status !== 0) fail("迁移失败，按上面的输出处理。服务已经是新产物，可能需要处理后再重启。");
})().catch((error) => {
	fail(error instanceof Error ? error.message : String(error));
});
