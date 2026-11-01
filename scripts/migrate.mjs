import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import mysql from "mysql2/promise";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "server", "db", "migrations");
const breakpoint = "--> statement-breakpoint";

loadDotenv({ path: join(root, ".env"), quiet: true });

const argv = process.argv.slice(2);
const allowDestructive = argv.includes("--allow-destructive");
const confirmProd = argv.includes("--confirm-prod");
// 只报告不执行：部署脚本用它判断「代码更新了但库还没跟上」，永远不动表结构
const checkOnly = argv.includes("--check");

const url = process.env.DATABASE_URL?.trim();
if (!url) {
	console.error("DATABASE_URL 未配置：请复制 .env.example 为 .env 并填写 MySQL 连接串。");
	process.exit(1);
}

const target = new URL(url);
const databaseName = target.pathname.replace(/^\//, "");

if (!databaseName) {
	console.error("DATABASE_URL 缺少库名：例如 mysql://user:pass@127.0.0.1:3306/prm_test");
	process.exit(1);
}

// 只有测试库 / 备份库允许直接跑；正式库必须显式确认。
const isSafeTarget = databaseName.endsWith("_test") || databaseName.endsWith("_backup");

if (!isSafeTarget && !confirmProd && !checkOnly) {
	console.error(
		[
			`当前目标是正式库「${databaseName}」，迁移会改动生产表结构。`,
			"",
			"请先做一次快照，确认备份可用后加 --confirm-prod 重跑：",
			"",
			"  mysqldump --single-transaction --quick --default-character-set=utf8mb4 \\",
			"    --set-gtid-purged=OFF --no-tablespaces --skip-lock-tables \\",
			`    ${databaseName} > backup-$(date +%F-%H%M).sql`,
			"",
			`  node scripts/migrate.mjs --confirm-prod`,
		].join("\n"),
	);
	process.exit(1);
}

// ---------------------------------------------------------------
// 危险语句扫描：迁移只该做 DDL，凡会删表/删数据的一律先拦下来。
// 之所以能在库里再兜一层，是因为迁移账号本身没有 DROP 权限，
// TRUNCATE TABLE 需要 DROP 权限 —— 两层都过不去才真的执行不了。
// ---------------------------------------------------------------
const DANGEROUS = [
	{ re: /\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW)\b/i, label: "DROP TABLE / DATABASE" },
	{ re: /\bTRUNCATE\b/i, label: "TRUNCATE（清空整表）" },
	{ re: /\bRENAME\s+TABLE\b/i, label: "RENAME TABLE" },
	{ re: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+(COLUMN|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i, label: "ALTER TABLE ... DROP" },
];

function stripSqlComments(sql) {
	return sql
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/--[^\n]*/g, " ")
		.replace(/^[ \t]*#[^\n]*/gm, " ");
}

function scanDangerous(statement) {
	const clean = stripSqlComments(statement);
	const labels = DANGEROUS.filter((rule) => rule.re.test(clean)).map((rule) => rule.label);

	// 带 WHERE 的 DELETE 是精准修正（例如清掉某条字段登记），放行；
	// 没有 WHERE 的 DELETE 才是整表清空，必须拦。
	if (/\bDELETE\s+FROM\b/i.test(clean) && !/\bWHERE\b/i.test(clean)) {
		labels.push("DELETE 无 WHERE（整表清空）");
	}

	return labels;
}

// ---------------------------------------------------------------
// 建库：有权限就建，没权限（正式环境由 DBA 预先建库）就跳过。
// 正式环境不应该由应用侧代码去动实例级结构。
// ---------------------------------------------------------------
const server = await mysql.createConnection({
	host: target.hostname,
	port: Number(target.port || 3306),
	user: decodeURIComponent(target.username),
	password: decodeURIComponent(target.password),
	multipleStatements: false,
});

try {
	await server.query(
		`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
	);
} catch (error) {
	const code = error?.code ?? "";
	if (code === "ER_DBACCESS_DENIED_ERROR" || code === "ER_ACCESS_DENIED_ERROR" || code === "ER_SPECIFIC_ACCESS_DENIED_ERROR") {
		console.warn(`无建库权限，假定库「${databaseName}」已由 DBA 预先创建。`);
	} else {
		throw error;
	}
}

await server.end();

const connection = await mysql.createConnection({
	uri: url,
	multipleStatements: false,
	charset: "utf8mb4_general_ci",
});

await connection.query(
	"CREATE TABLE IF NOT EXISTS `crm_migrations` (`name` VARCHAR(191) PRIMARY KEY, `applied_at` BIGINT NOT NULL)",
);

const [appliedRows] = await connection.query("SELECT `name` FROM `crm_migrations`");
const applied = new Set(appliedRows.map((row) => row.name));

const files = readdirSync(migrationsDir)
	.filter((name) => name.endsWith(".sql"))
	.sort();

// --check：只比对账本，列出尚未应用的迁移，然后退出。有未应用的返回 1。
if (checkOnly) {
	const pending = files.filter((file) => !applied.has(file));

	if (pending.length === 0) {
		console.log(`结构已同步：${files.length} 个迁移全部已应用。`);
	} else {
		console.log(`有 ${pending.length} 个迁移尚未应用到「${databaseName}」：`);
		for (const file of pending) console.log(`  - ${file}`);
		console.log("\n正式库需人工确认备份可用后执行：node scripts/migrate.mjs --confirm-prod");
	}

	await connection.end();
	process.exit(pending.length === 0 ? 0 : 1);
}

for (const file of files) {
	if (applied.has(file)) {
		console.log(`跳过 ${file}（已应用）`);
		continue;
	}

	const raw = readFileSync(join(migrationsDir, file), "utf8");
	const statements = raw
		.split(breakpoint)
		.map((statement) => statement.trim())
		.filter(Boolean);

	const hits = statements
		.map((statement) => ({ statement, labels: scanDangerous(statement) }))
		.filter((item) => item.labels.length > 0);

	if (hits.length > 0) {
		const declared = /@allow-destructive/i.test(raw);

		if (!allowDestructive || !declared) {
			console.error(`\n拒绝执行 ${file}：检测到可能清空数据的语句。`);
			for (const hit of hits) {
				console.error(`  - [${hit.labels.join(" / ")}] ${hit.statement.replace(/\s+/g, " ").slice(0, 160)}`);
			}
			console.error(
				[
					"",
					"如果确认需要执行：",
					`  1) 在 server/db/migrations/${file} 顶部加注释  -- @allow-destructive: <原因>`,
					"  2) 重新运行 node scripts/migrate.mjs --allow-destructive",
					"",
					"注意：正式库的迁移账号没有 DROP 权限，TRUNCATE / DROP TABLE 到库里也执行不了。",
				].join("\n"),
			);
			process.exit(1);
		}

		console.warn(`⚠ ${file} 含危险语句，已按 --allow-destructive 放行。`);
	}

	for (const statement of statements) {
		await connection.query(statement);
	}

	await connection.query("INSERT INTO `crm_migrations` (`name`, `applied_at`) VALUES (?, ?)", [
		file,
		Date.now(),
	]);

	console.log(`已应用 ${file}（${statements.length} 条语句）`);
}

const [tables] = await connection.query("SHOW TABLES");
console.log(`库 ${databaseName} 现有表：${tables.map((row) => Object.values(row)[0]).join(", ")}`);

await connection.end();
