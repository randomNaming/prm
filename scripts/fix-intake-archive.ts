/**
 * 一次性数据修正脚本。跑完即可删。
 *
 * 1) David McGowan：把被拼成一条的电话拆成 手机 / 家庭电话，「电话」留主号；
 * 2) 三条已有的导入会话回填 contact_id，标题补上「条数 + 覆盖区间」；
 * 3) 当时那条可编辑的 note 活动转成只读的 chat_log 锚点。
 *
 * 走的是与导入完全相同的通道（recordFact / attachConversation），
 * 所以结果就是「这一轮导对了会长成什么样」，不是手改出来的特例。
 */
import { and, eq, like } from "drizzle-orm";
import { pickContactId, type IntakeToolCall } from "../agent/intake";
import { activities, contactFacts, contacts, conversations } from "../server/db/schema";
import { attachConversation, conversationMessages } from "../server/utils/chat";
import { closeDb, db } from "../server/utils/db";
import { recordFact } from "../server/utils/facts";
import { seedBuiltinFields } from "../server/utils/fields";
import { digestIntakeText, INTAKE_TITLE_PREFIX, intakeTitle } from "../server/utils/intake-archive";
import { parseEvidence } from "../server/utils/parse";

const HEADER = /【微信聊天记录】对方昵称：(.+?)；来源文件：(.+)$/m;

const DAVID_PHONE = {
	primary: "708-557-7187",
	mobile: "708-557-7187",
	home: "708-756-0361",
};

const changes: string[] = [];

function guardTarget(): void {
	const url = process.env.DATABASE_URL ?? "";
	if (!url) throw new Error("DATABASE_URL 为空，拒绝运行。");
	if (/_test\b/.test(url)) throw new Error("目标是测试库，拒绝运行。");

	console.log("目标库:", url.replace(/:[^:@]+@/, ":****@"));
}

async function fixDavidPhones(): Promise<void> {
	const [david] = await db()
		.select()
		.from(contacts)
		.where(eq(contacts.firstName, "David McGowan"))
		.limit(1);

	if (!david) {
		console.log("没找到 David McGowan，跳过电话修正。");

		return;
	}

	const [oldFact] = await db()
		.select()
		.from(contactFacts)
		.where(and(eq(contactFacts.contactId, david.id), eq(contactFacts.field, "phone")))
		.limit(1);

	if (!oldFact) {
		console.log("David 没有 phone 事实，跳过电话修正。");

		return;
	}

	const evidence = parseEvidence(oldFact.evidence);

	console.log(`\n原 phone 列: ${JSON.stringify(david.phone)}`);
	console.log(`原 phone 事实: ${JSON.stringify(oldFact.value)}`);

	// 顺序有讲究：先把「电话」改对，它同时是主号位。
	for (const [field, value] of [
		["phone", DAVID_PHONE.primary],
		["手机", DAVID_PHONE.mobile],
		["家庭电话", DAVID_PHONE.home],
	] as const) {
		const result = await recordFact({
			contactId: david.id,
			field,
			value,
			evidence,
			source: "agent",
		});

		changes.push(`David ${field} → ${value}（${result.status}：${result.reason}）`);
	}

	const [after] = await db().select().from(contacts).where(eq(contacts.id, david.id)).limit(1);
	console.log(`新 phone 列: ${JSON.stringify(after?.phone)}`);
}

async function backfillArchives(): Promise<void> {
	const rows = await db().select().from(conversations);

	for (const row of rows) {
		if (!row.title?.startsWith(INTAKE_TITLE_PREFIX)) continue;

		const messages = await conversationMessages(row.id, 10);
		const user = messages.find((message) => message.role === "user");
		const assistant = messages.find((message) => message.role === "assistant");

		if (!user?.content) {
			console.log(`跳过 ${row.id}：没有 user 消息。`);

			continue;
		}

		const person = HEADER.exec(user.content)?.[1]?.trim() ?? row.title.slice(INTAKE_TITLE_PREFIX.length);
		const title = intakeTitle(person, digestIntakeText(user.content));
		const contactId = pickContactId((assistant?.toolCalls ?? []) as IntakeToolCall[]);

		if (!contactId) {
			console.log(`跳过 ${row.id}：工具调用里找不到联系人。`);

			continue;
		}

		const [contact] = await db().select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
		const companyId = contact?.companyId ?? null;

		await attachConversation({ conversationId: row.id, contactId, companyId, title });

		const [note] = await db()
			.select()
			.from(activities)
			.where(
				and(
					eq(activities.contactId, contactId),
					eq(activities.kind, "note"),
					like(activities.title, `${INTAKE_TITLE_PREFIX}%`),
				),
			)
			.limit(1);

		if (note) {
			await db()
				.update(activities)
				.set({ kind: "chat_log", title, companyId })
				.where(eq(activities.id, note.id));

			changes.push(`${contact?.firstName}：活动 ${note.id} note → chat_log，标题 ${title}`);
		} else {
			changes.push(`${contact?.firstName}：会话已挂上，但没找到对应的 note 活动可转换`);
		}

		changes.push(`${contact?.firstName}：会话 ${row.id} 挂到 ${contactId}，标题 ${title}`);
	}
}

async function main(): Promise<void> {
	guardTarget();

	const seeded = await seedBuiltinFields();
	console.log(`字段表已同步（${seeded} 个内置字段）。`);

	await fixDavidPhones();
	await backfillArchives();

	console.log("\n=== 变更 ===");
	for (const line of changes) console.log("·", line);

	await closeDb();
}

await main();
