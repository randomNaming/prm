import { createHash } from "node:crypto";
import {
	createConnection,
	type Connection,
	type ConnectionOptions,
	type RowDataPacket,
} from "mysql2/promise";

/**
 * 启动时自动迁移（Flyway 的 migrate 阶段）。
 *
 * 目标不是「让数据库跟着代码随便变」，而是在尽量少人工介入的前提下，
 * 把「代码上线了、表结构还没跟上」这件事消灭掉：
 *
 * - 迁移 SQL 由 Nitro serverAssets 打进 .output，和代码永远同版本；
 * - 应用启动后第一个请求进来前自动补齐未应用的迁移；
 * - 自动模式只允许「增」的语句（建表 / 建索引 / 加列），
 *   出现 UPDATE / DELETE / INSERT / ALTER ... CHANGE|MODIFY / RENAME / DROP / TRUNCATE
 *   一律拒绝启动，必须显式设置 PRM_ALLOW_UNSAFE_MIGRATIONS=1 才放行；
 * - 每个文件记录校验和，已应用的迁移被改过会拒绝启动（需要时用 PRM_SKIP_CHECKSUM=1 跳过）；
 * - 有未应用迁移时先对现有表做行数快照，迁移后逐一比对，行数变化立即报错；
 * - GET_LOCK 防止多进程同时迁移。
 *
 * 迁移账号（PRM_MIGRATE_URL）只在启动迁移阶段使用，业务读写仍走 DATABASE_URL。
 */

const BREAKPOINT = "--> statement-breakpoint";
const LEDGER_TABLE = "crm_migrations";
const CHECKSUM_TABLE = "crm_migration_checks";
const LOCK_NAME = "prm:auto-migrate";
const LOCK_TIMEOUT_SECONDS = 30;

/** 无论什么模式都不该自动执行的语句；只有显式危险模式 + 文件声明才放行。 */
const HARD_BLOCK = [
	{ re: /\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX)\b/i, label: "DROP" },
	{ re: /\bDROP\s+(COLUMN|FOREIGN\s+KEY|PRIMARY\s+KEY|CHECK)\b/i, label: "DROP COLUMN / KEY" },
	{ re: /\bTRUNCATE\b/i, label: "TRUNCATE" },
	{ re: /\bRENAME\s+(TABLE|COLUMN|INDEX)\b/i, label: "RENAME" },
	// 组合 ALTER（ADD + MODIFY/CHANGE）也要拦住：只靠「以 ADD 开头」判断会漏。
	{ re: /\b(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?[`\w]/i, label: "MODIFY / CHANGE COLUMN" },
];

/** 自动模式允许的「只增」语句。 */
const ADDITIVE_RULES = [
	/^CREATE\s+TABLE\b/i,
	/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i,
	/^ALTER\s+TABLE\s+(?:`[^`]+`|\w+)\s+ADD\s+(?:COLUMN|INDEX|UNIQUE\s+INDEX|KEY|UNIQUE\s+KEY|CONSTRAINT|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i,
];

export type MigrationSummary = {
	total: number;
	/** 本次启动执行掉的迁移。 */
	applied: string[];
	/** 执行前仍未应用的迁移（执行成功后为空）。 */
	pendingBefore: string[];
};

type Migration = {
	name: string;
	sql: string;
	checksum: string;
};

function log(message: string, ...rest: unknown[]): void {
	console.log(`[migrate] ${message}`, ...rest);
}

function warn(message: string, ...rest: unknown[]): void {
	console.warn(`[migrate] ${message}`, ...rest);
}

function sha256(text: string): string {
	return createHash("sha256").update(text.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

function stripSqlComments(sql: string): string {
	return sql
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/--[^\n]*/g, " ")
		.replace(/^[ \t]*#[^\n]*/gm, " ");
}

function splitStatements(sql: string): string[] {
	return sql
		.split(BREAKPOINT)
		.map((statement) => statement.trim())
		.filter(Boolean);
}

function normalizeStatement(statement: string): string {
	return stripSqlComments(statement).replace(/\s+/g, " ").trim();
}

function snippet(statement: string): string {
	const clean = normalizeStatement(statement);

	return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
}

function quoteIdentifier(identifier: string): string {
	return `\`${identifier.replace(/`/g, "``")}\``;
}

export type StatementVerdict = {
	statement: string;
	level: "safe" | "hard" | "other";
	label: string | null;
};

/**
 * 把每个语句分成三档：
 * - safe：自动模式可直接执行（只增）；
 * - hard：DROP / TRUNCATE / RENAME / MODIFY / CHANGE，任何自动模式都不执行；
 * - other：UPDATE / DELETE / INSERT 等数据或结构变更，需要显式 --unsafe 才执行。
 */
export function inspectMigrationSql(sql: string): StatementVerdict[] {
	const verdicts: StatementVerdict[] = [];

	for (const statement of splitStatements(sql)) {
		const clean = normalizeStatement(statement);
		if (!clean) continue;

		const hard = HARD_BLOCK.find((rule) => rule.re.test(clean));
		if (hard) {
			verdicts.push({ statement, level: "hard", label: hard.label });
			continue;
		}

		const safe = ADDITIVE_RULES.some((rule) => rule.test(clean));
		verdicts.push({ statement, level: safe ? "safe" : "other", label: null });
	}

	return verdicts;
}

/**
 * 迁移 SQL 来自本地仓库，不是外部输入；这里仍做一层白名单，
 * 保证「自动模式」永远不可能执行删表 / 改数据 / 改列定义这类语句。
 */
function assertStatementsSafe(migration: Migration): void {
	const allowUnsafe = process.env.PRM_ALLOW_UNSAFE_MIGRATIONS === "1";
	const allowDestructive =
		process.env.PRM_ALLOW_DESTRUCTIVE === "1" && /@allow-destructive/i.test(migration.sql);

	for (const verdict of inspectMigrationSql(migration.sql)) {
		if (verdict.level === "safe") continue;

		if (verdict.level === "hard") {
			if (!allowDestructive) {
				throw new Error(
					`迁移 ${migration.name} 含危险语句（${verdict.label}），已拒绝自动执行：${snippet(verdict.statement)}。` +
						`如确认已备份、确实需要执行，请在迁移文件顶部注明 -- @allow-destructive 并设置 PRM_ALLOW_DESTRUCTIVE=1。`,
				);
			}

			warn(`${migration.name} 含 ${verdict.label}，已按 PRM_ALLOW_DESTRUCTIVE=1 放行：${snippet(verdict.statement)}`);
			continue;
		}

		if (!allowUnsafe) {
			throw new Error(
				`迁移 ${migration.name} 含非「只增」语句，已拒绝自动执行：${snippet(verdict.statement)}。` +
					`请确认已备份；如确实需要在启动时执行，设置 PRM_ALLOW_UNSAFE_MIGRATIONS=1 后重启。`,
			);
		}

		warn(`${migration.name} 含非「只增」语句，已按 PRM_ALLOW_UNSAFE_MIGRATIONS=1 放行：${snippet(verdict.statement)}`);
	}
}

/** 从 .output 内置的 serverAssets 读取迁移文件，按文件名排序（与 CLI 一致）。 */
async function loadMigrations(): Promise<Migration[]> {
	const storage = useStorage("assets:migrations");
	const keys = (await storage.getKeys()).filter((key) => key.endsWith(".sql")).sort();

	const migrations: Migration[] = [];

	for (const key of keys) {
		const raw = await storage.getItem<string>(key);

		if (typeof raw !== "string") {
			throw new Error(`读取迁移文件失败：${key}`);
		}

		const name = key.split(/[/\\:]/).pop() ?? key;

		migrations.push({ name, sql: raw, checksum: sha256(raw) });
	}

	const seen = new Set<string>();

	for (const migration of migrations) {
		if (seen.has(migration.name)) {
			throw new Error(`迁移文件名重复：${migration.name}`);
		}

		seen.add(migration.name);
	}

	return migrations;
}

function connectionOptions(url: string): ConnectionOptions {
	let parsed: URL;

	try {
		parsed = new URL(url);
	} catch {
		throw new Error("PRM_MIGRATE_URL 格式无法解析，应形如 mysql://用户:密码@127.0.0.1:3308/库名");
	}

	const database = parsed.pathname.replace(/^\//, "");

	if (!database) {
		throw new Error("PRM_MIGRATE_URL 缺少库名");
	}

	return {
		host: parsed.hostname,
		port: Number(parsed.port || 3306),
		user: decodeURIComponent(parsed.username),
		password: decodeURIComponent(parsed.password),
		database,
		charset: "utf8mb4",
		connectTimeout: 10_000,
		multipleStatements: false,
		dateStrings: true,
	};
}

async function ensureLedgerTables(connection: Connection): Promise<void> {
	await connection.query(
		`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(LEDGER_TABLE)} (
			\`name\` VARCHAR(191) PRIMARY KEY,
			\`applied_at\` BIGINT NOT NULL
		)`,
	);

	await connection.query(
		`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(CHECKSUM_TABLE)} (
			\`name\` VARCHAR(191) PRIMARY KEY,
			\`checksum\` CHAR(64) NOT NULL,
			\`applied_at\` BIGINT NOT NULL
		)`,
	);
}

async function readAppliedNames(connection: Connection): Promise<Set<string>> {
	const [rows] = await connection.query<RowDataPacket[]>(
		`SELECT \`name\` FROM ${quoteIdentifier(LEDGER_TABLE)}`,
	);

	return new Set(rows.map((row) => String(row.name)));
}

async function readChecksums(connection: Connection): Promise<Map<string, string>> {
	const [rows] = await connection.query<RowDataPacket[]>(
		`SELECT \`name\`, \`checksum\` FROM ${quoteIdentifier(CHECKSUM_TABLE)}`,
	);

	return new Map(rows.map((row) => [String(row.name), String(row.checksum)]));
}

/**
 * 已应用的迁移必须和仓库里的文件一致。
 * 老版本迁移（本次功能上线前应用的）没有校验和记录，首次启动按当前文件补齐。
 */
async function validateAppliedChecksums(
	connection: Connection,
	migrations: Migration[],
	applied: Set<string>,
	checksums: Map<string, string>,
): Promise<void> {
	const skip = process.env.PRM_SKIP_CHECKSUM === "1";

	for (const migration of migrations) {
		if (!applied.has(migration.name)) continue;

		const recorded = checksums.get(migration.name);

		if (!recorded) {
			await connection.query(
				`INSERT INTO ${quoteIdentifier(CHECKSUM_TABLE)} (\`name\`, \`checksum\`, \`applied_at\`)
				 VALUES (?, ?, ?)
				 ON DUPLICATE KEY UPDATE \`checksum\` = VALUES(\`checksum\`)`,
				[migration.name, migration.checksum, Date.now()],
			);
			log(`补记校验和：${migration.name}`);
			continue;
		}

		if (recorded === migration.checksum) continue;

		if (skip) {
			warn(`已应用的迁移 ${migration.name} 内容与校验和不一致，按 PRM_SKIP_CHECKSUM=1 跳过`);
			continue;
		}

		throw new Error(
			`已应用的迁移 ${migration.name} 内容被修改过（校验和不一致）。` +
				`迁移文件一旦应用就不应再改；如确属笔误修正，请设置 PRM_SKIP_CHECKSUM=1 启动一次后再改回。`,
		);
	}
}

/** 对现有表做精确行数快照：DDL 不应该改变任何已有表的行数。 */
async function snapshotRowCounts(connection: Connection): Promise<Map<string, number>> {
	const [tables] = await connection.query<RowDataPacket[]>(
		`SELECT \`TABLE_NAME\` AS \`name\`
		 FROM \`information_schema\`.\`TABLES\`
		 WHERE \`TABLE_SCHEMA\` = DATABASE() AND \`TABLE_TYPE\` = 'BASE TABLE'
		 ORDER BY \`TABLE_NAME\``,
	);

	const counts = new Map<string, number>();

	for (const row of tables) {
		const table = String(row.name);

		if (table === LEDGER_TABLE || table === CHECKSUM_TABLE) continue;

		const [countRows] = await connection.query<RowDataPacket[]>(
			`SELECT COUNT(*) AS \`total\` FROM ${quoteIdentifier(table)}`,
		);

		counts.set(table, Number(countRows[0]?.total ?? 0));
	}

	return counts;
}

function compareRowCounts(before: Map<string, number>, after: Map<string, number>): string[] {
	const changes: string[] = [];

	for (const [table, count] of before) {
		const next = after.get(table);

		if (next !== undefined && next !== count) {
			changes.push(`${table}: ${count} → ${next}`);
		}
	}

	return changes;
}

async function applyMigration(connection: Connection, migration: Migration): Promise<void> {
	assertStatementsSafe(migration);

	const statements = splitStatements(migration.sql);

	log(`应用 ${migration.name}（${statements.length} 条语句）`);

	for (const statement of statements) {
		await connection.query(statement);
	}

	const appliedAt = Date.now();

	await connection.query(
		`INSERT INTO ${quoteIdentifier(LEDGER_TABLE)} (\`name\`, \`applied_at\`) VALUES (?, ?)`,
		[migration.name, appliedAt],
	);

	await connection.query(
		`INSERT INTO ${quoteIdentifier(CHECKSUM_TABLE)} (\`name\`, \`checksum\`, \`applied_at\`)
		 VALUES (?, ?, ?)
		 ON DUPLICATE KEY UPDATE \`checksum\` = VALUES(\`checksum\`), \`applied_at\` = VALUES(\`applied_at\`)`,
		[migration.name, migration.checksum, appliedAt],
	);

	log(`完成 ${migration.name}`);
}

export async function runAutoMigrations(): Promise<MigrationSummary> {
	const url = process.env.PRM_MIGRATE_URL?.trim();

	if (!url) {
		throw new Error("PRM_MIGRATE_URL 未配置，无法执行启动迁移");
	}

	const migrations = await loadMigrations();
	const summary: MigrationSummary = { total: migrations.length, applied: [], pendingBefore: [] };

	if (migrations.length === 0) {
		warn("没有找到任何迁移文件（serverAssets 未打包？）");
		return summary;
	}

	const connection = await createConnection(connectionOptions(url));
	let locked = false;

	try {
		const [lockRows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS `ok`", [
			LOCK_NAME,
			LOCK_TIMEOUT_SECONDS,
		]);

		if (Number(lockRows[0]?.ok) !== 1) {
			throw new Error("另一个进程正在执行迁移（GET_LOCK 超时），本次启动中止");
		}

		locked = true;

		await ensureLedgerTables(connection);

		const applied = await readAppliedNames(connection);
		const checksums = await readChecksums(connection);

		await validateAppliedChecksums(connection, migrations, applied, checksums);

		const pending = migrations.filter((migration) => !applied.has(migration.name));
		summary.pendingBefore = pending.map((migration) => migration.name);

		if (pending.length === 0) {
			log(`结构已是最新（${migrations.length} 个迁移，无需执行）`);
			return summary;
		}

		log(`发现 ${pending.length} 个未应用迁移：${pending.map((item) => item.name).join(", ")}`);

		// 先全部做安全检查，避免执行到一半才发现后面有个危险语句。
		for (const migration of pending) {
			assertStatementsSafe(migration);
		}

		const skipRowCount = process.env.PRM_SKIP_ROWCOUNT === "1";
		const before = skipRowCount ? null : await snapshotRowCounts(connection);

		for (const migration of pending) {
			await applyMigration(connection, migration);
			summary.applied.push(migration.name);
		}

		if (before) {
			const after = await snapshotRowCounts(connection);
			const changes = compareRowCounts(before, after);

			if (changes.length > 0) {
				throw new Error(
					`迁移后已有表行数发生变化（自动模式本不该发生）：${changes.join("；")}。` +
						"请立即检查服务日志与备份，必要时回滚代码。",
				);
			}
		}

		log(`本次共应用 ${summary.applied.length} 个迁移：${summary.applied.join(", ")}`);

		return summary;
	} finally {
		if (locked) {
			try {
				await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
			} catch {
				// 连接异常时锁会随连接关闭释放，不再纠缠。
			}
		}

		await connection.end().catch(() => {
			// 关闭失败不影响启动结果。
		});
	}
}

let gate: Promise<MigrationSummary | null> | null = null;
let statusLogged = false;

/**
 * 进程内唯一的迁移入口：Nitro 启动插件先调用（立即开始），请求中间件再 await 同一个 Promise。
 * 没配置迁移账号、或显式 PRM_AUTO_MIGRATE=off 时不做任何数据库操作。
 */
export function ensureAutoMigrations(): Promise<MigrationSummary | null> {
	if (gate) return gate;

	const url = process.env.PRM_MIGRATE_URL?.trim();

	if (process.env.PRM_AUTO_MIGRATE === "off") {
		if (!statusLogged) {
			log("PRM_AUTO_MIGRATE=off，跳过启动自动迁移");
			statusLogged = true;
		}

		gate = Promise.resolve(null);
		return gate;
	}

	if (!url) {
		if (!statusLogged) {
			warn("未配置 PRM_MIGRATE_URL，跳过启动自动迁移");
			statusLogged = true;
		}

		gate = Promise.resolve(null);
		return gate;
	}

	log("开始检查数据库迁移……");
	gate = runAutoMigrations();

	return gate;
}
