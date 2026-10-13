import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";
import { CONFIG } from "./config";
import { env } from "./env";

export type Database = MySql2Database<typeof schema>;

let activePool: mysql.Pool | null = null;
let activeDatabase: Database | null = null;

export function databaseConfigured(): boolean {
	return env().databaseUrl.length > 0;
}

export function connectionPool(): mysql.Pool {
	if (activePool) return activePool;

	const url = env().databaseUrl;
	if (!url) throw new Error("DATABASE_URL 未配置：请在 .env 中填写 MySQL 连接串。");

	activePool = mysql.createPool({
		uri: url,
		connectionLimit: CONFIG.db.connectionLimit,
		connectTimeout: CONFIG.db.connectTimeoutMs,
		supportBigNumbers: true,
		bigNumberStrings: false,
		charset: "utf8mb4_general_ci",
		timezone: "Z",
	});

	return activePool;
}

export function db(): Database {
	if (activeDatabase) return activeDatabase;

	activeDatabase = drizzle(connectionPool(), { schema, mode: "default" });

	return activeDatabase;
}

export async function closeDb(): Promise<void> {
	if (activePool) {
		await activePool.end();
		activePool = null;
		activeDatabase = null;
	}
}
