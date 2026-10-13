import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import mysql from "mysql2/promise";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "server", "db", "migrations");
const breakpoint = "--> statement-breakpoint";

loadDotenv({ path: join(root, ".env"), quiet: true });

const url = process.env.DATABASE_URL?.trim();
if (!url) {
	console.error("DATABASE_URL 未配置：请复制 .env.example 为 .env 并填写 MySQL 连接串。");
	process.exit(1);
}

const target = new URL(url);
const databaseName = target.pathname.replace(/^\//, "");

if (!databaseName) {
	console.error("DATABASE_URL 缺少库名：例如 mysql://user:pass@127.0.0.1:3306/crm_mini");
	process.exit(1);
}

const server = await mysql.createConnection({
	host: target.hostname,
	port: Number(target.port || 3306),
	user: decodeURIComponent(target.username),
	password: decodeURIComponent(target.password),
	multipleStatements: false,
});

await server.query(
	`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
);
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

for (const file of files) {
	if (applied.has(file)) {
		console.log(`跳过 ${file}（已应用）`);
		continue;
	}

	const sql = readFileSync(join(migrationsDir, file), "utf8");
	const statements = sql
		.split(breakpoint)
		.map((statement) => statement.trim())
		.filter(Boolean);

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
