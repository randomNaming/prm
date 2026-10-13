import { closeDb, connectionPool, db } from "../server/utils/db";
import { fieldDefs } from "../server/db/schema";
import { seedBuiltinFields } from "../server/utils/fields";
import type { ContactInput } from "../server/utils/validate";
import { createContact } from "../server/utils/contacts";

export const TABLES = [
	"messages",
	"conversations",
	"agent_tasks",
	"company_facts",
	"contact_facts",
	"activities",
	"deals",
	"contacts",
	"companies",
];

export async function resetDatabase(): Promise<void> {
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
		businessRole: input.businessRole ?? null,
		linkedin: input.linkedin ?? null,
		github: input.github ?? null,
		notes: input.notes ?? null,
		companyId: input.companyId ?? null,
	});
}

export function evidence(kind = "crm.note", quote = "王小明，产品经理", ref: string | null = null) {
	return { kind, quote, ref };
}
