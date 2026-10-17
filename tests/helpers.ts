import { closeDb, connectionPool, db } from "../server/utils/db";
import { fieldDefs } from "../server/db/schema";
import { seedBuiltinFields } from "../server/utils/fields";
import type { ContactInput } from "../server/utils/validate";
import { createContact } from "../server/utils/contacts";

export const TABLES = [
	"messages",
	"conversations",
	"agent_tasks",
	"board_pins",
	"company_facts",
	"contact_facts",
	"relationship_insights",
	"promises",
	"activities",
	"deals",
	"contacts",
	"companies",
];

/**
 * 保险丝：resetDatabase 会清空所连库的全部业务表。
 * 2026-10-16 曾因对正式库误跑测试清空过一次数据（靠 binlog 才恢复）。
 * 因此只允许连库名以 `_test` 结尾的专用测试库，其他库一律拒绝执行。
 */
function guardTestDatabase(): string {
	const raw = process.env.DATABASE_URL ?? "";
	let name = "";

	try {
		name = new URL(raw).pathname.replace(/^\//, "");
	} catch {
		// URL 解析失败按未配置处理，走下面的统一报错。
	}

	if (!name.endsWith("_test")) {
		throw new Error(
			`拒绝执行 resetDatabase：当前连接的库是「${name || "(无法解析)"}」。` +
				"测试会清空全部数据，只允许连库名以 _test 结尾的专用测试库" +
				"（例如 DATABASE_URL=mysql://.../crm_mini_test）。",
		);
	}

	return name;
}

export async function resetDatabase(): Promise<void> {
	guardTestDatabase();
	const connection = await connectionPool().getConnection();

	try {
		await connection.query("SET FOREIGN_KEY_CHECKS = 0");

		for (const table of TABLES) {
			await connection.query(`TRUNCATE TABLE \`${table}\``);
		}

		await connection.query("SET FOREIGN_KEY_CHECKS = 1");
	} finally {
		connection.release();
	}

	await closeDb();
	await db().delete(fieldDefs);
	await seedBuiltinFields();
	await closeDb();
}

export function useAgentEnv(baseUrl: string): void {
	process.env.ZAI_API_KEY = "test-key";
	process.env.ZAI_BASE_URL = baseUrl;
	process.env.ZAI_MODEL = "glm-test";
}

export async function contactFixture(input: Partial<ContactInput> = {}) {
	return createContact({
		firstName: input.firstName ?? "王小明",
		lastName: input.lastName ?? null,
		title: input.title ?? null,
		email: input.email ?? null,
		phone: input.phone ?? null,
		wechatId: input.wechatId ?? null,
		address: input.address ?? null,
		country: input.country ?? null,
		postalCode: input.postalCode ?? null,
		customerGrade: input.customerGrade ?? null,
		businessRole: input.businessRole ?? null,
		relationshipState: input.relationshipState ?? null,
		repairNote: input.repairNote ?? null,
		linkedin: input.linkedin ?? null,
		github: input.github ?? null,
		notes: input.notes ?? null,
		companyId: input.companyId ?? null,
	});
}

export function evidence(kind = "crm.note", quote = "王小明，产品经理", ref: string | null = null, time: string | null = null) {
	return { kind, quote, ref, time };
}
