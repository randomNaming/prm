import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import mysql from "mysql2/promise";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.db.local");
const CHUNK = 500;

function fail(message) {
	console.error(`错误：${message}`);
	process.exit(1);
}

if (!existsSync(envFile)) {
	fail(`缺少 ${envFile}。请先按文件内的注释填写连接串。`);
}

// 读项目根 .env，用于派生 nas-legacy（复用现有账号读旧库）
loadDotenv({ path: join(root, ".env"), quiet: true });

// 只读自己需要的变量，不污染 process.env
const env = {};
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
	const text = line.trim();
	if (!text || text.startsWith("#")) continue;
	const index = text.indexOf("=");
	if (index < 0) continue;
	env[text.slice(0, index).trim()] = text.slice(index + 1).trim();
}

const argv = process.argv.slice(2);
const readArg = (name) => {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
};

const fromKey = readArg("--from");
const toKey = readArg("--to");
const reset = argv.includes("--reset");

if (!fromKey || !toKey) {
	fail("用法：node scripts/db-copy.mjs --from nas-legacy --to NAS_TEST_URL [--reset]");
}

function resolveUrl(key) {
	// env：直接用 .env 里的 DATABASE_URL。
	// 同一个实例内的复制（改库名之外）不需要第二个配置文件。
	if (key === "env") {
		const base = process.env.DATABASE_URL?.trim();
		if (!base) fail(".env 里没有 DATABASE_URL。");
		return base;
	}

	// nas-legacy：复用 .env 里现有的账号，只把库名换成旧库 crm_mini。
	// 现有账号本来就只被授权到 crm_mini.*，读旧库够用，不需要 root，
	// 也不用把凭据复制进第二个文件。
	if (key === "nas-legacy") {
		const base = process.env.DATABASE_URL?.trim();
		if (!base) fail(".env 里没有 DATABASE_URL，无法派生旧库连接串。");
		const url = new URL(base);
		url.pathname = "/crm_mini";
		return url.toString();
	}

	if (!env[key] || !env[key].startsWith("mysql://")) {
		fail(`.env.db.local 里的 ${key} 没有填写或格式不对（应以 mysql:// 开头）。`);
	}

	return env[key];
}

function parseUrl(label, rawUrl) {
	const url = new URL(rawUrl);
	const database = url.pathname.replace(/^\//, "");
	if (!database) fail(`${label} 缺少库名，形如 mysql://用户:密码@主机:端口/库名`);
	return {
		label,
		host: url.hostname,
		port: Number(url.port || 3306),
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database,
		charset: "utf8mb4_general_ci",
		// 不做时区换算，DATETIME 原样按字符串读写
		dateStrings: true,
		multipleStatements: false,
	};
}

const source = parseUrl(fromKey, resolveUrl(fromKey));
const target = parseUrl(toKey, resolveUrl(toKey));

if (source.host === target.host && source.port === target.port && source.database === target.database) {
	fail("源库和目标库是同一个，没有任何操作可做。");
}

console.log(`源：${source.user}@${source.host}:${source.port}/${source.database}`);
console.log(`目标：${target.user}@${target.host}:${target.port}/${target.database}`);

// mysql2 不认识 label 字段，连接前剔除，避免未来版本直接报错
const toConnectionConfig = ({ label, ...config }) => config;

// 目标库可能尚未创建（正式库通常由 DBA 预建）。先尝试直连，库不存在时补建一次。
async function connectTarget(config) {
	try {
		return await mysql.createConnection(config);
	} catch (error) {
		if (error?.code !== "ER_BAD_DB_ERROR") throw error;
		console.log(`\n目标库「${config.database}」不存在，尝试创建`);
		const { database, ...serverConfig } = config;
		const server = await mysql.createConnection(serverConfig);
		try {
			await server.query(
				`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
			);
		} catch (createError) {
			if (
				["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR"].includes(
					createError?.code,
				)
			) {
				fail(
					`账号 ${config.user} 没有建库权限，请先有人在服务器上执行：\n` +
						`CREATE DATABASE \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`,
				);
			}
			throw createError;
		} finally {
			await server.end();
		}
		return await mysql.createConnection(config);
	}
}

const src = await mysql.createConnection(toConnectionConfig(source));
const dst = await connectTarget(toConnectionConfig(target));

const [tableRows] = await src.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
const tables = tableRows.map((row) => Object.values(row)[0]);

if (tables.length === 0) {
	fail("源库里没有任何表，请确认库名是否正确。");
}

const [existingRows] = await dst.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
const existing = existingRows.map((row) => Object.values(row)[0]);
const conflicts = tables.filter((name) => existing.includes(name));

if (conflicts.length > 0) {
	if (!reset) {
		fail(
			`目标库里已经存在这些表：${conflicts.join(", ")}。\n` +
				"为避免覆盖数据，本脚本不会自动删表。确认目标库可以清空后，加 --reset 重跑（仅限库名以 _test 结尾的测试库）。",
		);
	}

	if (!target.database.endsWith("_test")) {
		fail(`--reset 只允许用在库名以 _test 结尾的测试库上，当前目标是 ${target.database}。`);
	}

	console.log(`\n--reset：先清空目标库的 ${existing.length} 张表`);
	await dst.query("SET FOREIGN_KEY_CHECKS = 0");
	for (const name of existing) {
		await dst.query(`DROP TABLE IF EXISTS \`${name}\``);
	}
	await dst.query("SET FOREIGN_KEY_CHECKS = 1");
}

let totalRows = 0;

await dst.query("SET FOREIGN_KEY_CHECKS = 0");

for (const table of tables) {
	const [createRows] = await src.query(`SHOW CREATE TABLE \`${table}\``);
	const ddl = createRows[0]["Create Table"];
	await dst.query(ddl);

	const [rows] = await src.query(`SELECT * FROM \`${table}\``);

	// JSON 列 mysql2 读出来是 JS 对象，直接回写会被 toString 成 [object Object]，
	// 所以先查列类型，写之前统一 JSON.stringify。
	const [columnRows] = await src.query(
		"SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
		[source.database, table],
	);
	const jsonColumns = new Set(
		columnRows.filter((row) => row.DATA_TYPE === "json").map((row) => row.COLUMN_NAME),
	);

	if (rows.length > 0) {
		const columns = Object.keys(rows[0]);
		const columnList = columns.map((name) => `\`${name}\``).join(", ");

		for (let offset = 0; offset < rows.length; offset += CHUNK) {
			const slice = rows.slice(offset, offset + CHUNK);
			const values = slice.map((row) =>
				columns.map((name) => {
					const value = row[name];
					if (jsonColumns.has(name) && value !== null && typeof value === "object") {
						return JSON.stringify(value);
					}
					return value;
				}),
			);
			await dst.query(`INSERT INTO \`${table}\` (${columnList}) VALUES ?`, [values]);
		}
	}

	totalRows += rows.length;
	console.log(`  ${table}: ${rows.length} 行`);
}

await dst.query("SET FOREIGN_KEY_CHECKS = 1");

console.log(`\n完成：${tables.length} 张表，共 ${totalRows} 行。`);

// 逐表核对行数，防止静默丢数据
console.log("\n行数核对：");
let mismatch = 0;
for (const table of tables) {
	const [[{ srcCount }]] = await src.query(`SELECT COUNT(*) AS srcCount FROM \`${table}\``);
	const [[{ dstCount }]] = await dst.query(`SELECT COUNT(*) AS dstCount FROM \`${table}\``);
	const ok = Number(srcCount) === Number(dstCount);
	if (!ok) mismatch += 1;
	console.log(`  ${ok ? "✓" : "✗"} ${table}: ${srcCount} -> ${dstCount}`);
}

await src.end();
await dst.end();

if (mismatch > 0) {
	console.error(`\n有 ${mismatch} 张表行数不一致，请检查后再继续。`);
	process.exit(1);
}

console.log("\n全部一致。");
