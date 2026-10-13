import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { runIntake, buildIntakeMessage } from "../agent/intake";
import { activities, conversations } from "../server/db/schema";
import { closeDb, db } from "../server/utils/db";
import { intakeArchives } from "../server/utils/intake-archive";
import { resetDatabase, useAgentEnv } from "./helpers";
import { startStubModel, type StubModel } from "./stub-model";

let stub: StubModel | null = null;

beforeEach(async () => {
	await resetDatabase();
});

afterEach(async () => {
	if (stub) {
		await stub.close();
		stub = null;
	}
});

afterAll(async () => {
	await closeDb();
});

const SAMPLE = `翔铭达智能健康手表～许东明
2026年9月3日 15:16
【姓名】许东明
【电话】19924544039
【公司名称】深圳市领健（翔铭达）科技有限公司
【主营产品】集研发、生产、销售于一体的国家高新技术企业，主要产品包括智能手表等。
【地址】广东省深圳市宝安区黄麻布路普顺达科技楼C4栋A座7-8层。`;

describe("buildIntakeMessage：把记录组装成 Agent 可读文本", () => {
	test("头部带昵称与来源文件名，尾部有说明，中间原文逐字保留", () => {
		const message = buildIntakeMessage({
			person: "许东明",
			file: "聊天记录.txt",
			text: SAMPLE,
		});

		expect(message).toContain("对方昵称：许东明");
		expect(message).toContain("来源文件：聊天记录.txt");
		expect(message).toContain("【电话】19924544039");
		expect(message).toContain("未做任何加工");
	});

	test("缺文件名时用占位提示，不报错", () => {
		const message = buildIntakeMessage({ person: "张三", file: null, text: "你好" });
		expect(message).toContain("（未提供文件名）");
	});
});

describe("runIntake：抽字段 → 建档 → 写证据", () => {
	test("完整链路：建联系人 + 建公司 + 写字段 + 自动写只读留底", async () => {
		stub = await startStubModel([
			{
				content: "",
				toolCalls: [
					{
						name: "ensure_contact",
						args: {
							name: "许东明",
							wechat_id: "许东明",
							phone: "19924544039",
							evidence: [
								{
									kind: "wechat.chat",
									quote: "【姓名】许东明 【电话】19924544039",
									ref: "许东明@聊天记录.txt",
								},
							],
						},
					},
					{
						name: "ensure_company",
						args: {
							name: "深圳市领健（翔铭达）科技有限公司",
							evidence: [
								{
									kind: "wechat.chat",
									quote: "【公司名称】深圳市领健（翔铭达）科技有限公司",
									ref: "许东明@聊天记录.txt",
								},
							],
						},
					},
				],
			},
			{ content: "已从这段记录中新建联系人许东明与公司深圳市领健（翔铭达）科技有限公司。" },
		]);
		useAgentEnv(stub.baseUrl);

		const result = await runIntake({
			person: "许东明",
			file: "聊天记录.txt",
			text: SAMPLE,
		});

		expect(result.created.contacts).toHaveLength(1);
		expect(result.created.contacts[0].name).toBe("许东明");
		expect(result.created.companies).toHaveLength(1);
		expect(result.created.companies[0].name).toBe("深圳市领健（翔铭达）科技有限公司");

		expect(result.counts.ensure_contact).toBe(1);
		expect(result.counts.ensure_company).toBe(1);

		expect(result.summary).toContain("许东明");
		expect(result.conversationId).toBeTruthy();
		expect(result.contactId).toBe(result.created.contacts[0].id);

		// 会话必须挂到人身上：不回填的话它三个外键全为 NULL，
		// 只会落进全局对话，联系人页面上永远翻不到这次导入。
		const [conversation] = await db()
			.select()
			.from(conversations)
			.where(eq(conversations.id, result.conversationId));
		expect(conversation.contactId).toBe(result.contactId);

		// 时间线锚点由服务端确定性地写，类型是只读的 chat_log，不是模型自己调的 note。
		const rows = await db()
			.select()
			.from(activities)
			.where(eq(activities.contactId, result.contactId ?? ""));
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe("chat_log");
		expect(rows[0].title).toContain("微信记录导入：许东明");
		expect(rows[0].body).toContain("许东明");
	});

	test("留底标题带条数与覆盖区间，二次激活时先看时间差", async () => {
		const CHATTY = [
			"[2026-08-18 09:16] 我方 Xia Jingwei:",
			"  Cell: 708-557-7187",
			"[2026-09-11 17:02] 对方 David McGowan:",
			"  Home : 708-756-0361",
		].join("\n");

		stub = await startStubModel([
			{
				content: "",
				toolCalls: [
					{
						name: "ensure_contact",
						args: {
							name: "David McGowan",
							evidence: [{ kind: "wechat.chat", quote: "Cell: 708-557-7187", ref: "d@a.txt" }],
						},
					},
				],
			},
			{ content: "新建联系人 David McGowan。" },
		]);
		useAgentEnv(stub.baseUrl);

		const result = await runIntake({ person: "David McGowan", file: "a.txt", text: CHATTY });
		expect(result.contactId).toBeTruthy();

		const archives = await intakeArchives(result.contactId ?? "");

		expect(archives).toHaveLength(1);
		expect(archives[0].conversationId).toBe(result.conversationId);
		expect(archives[0].title).toContain("2 条");
		expect(archives[0].title).toContain("2026-08-18 ~ 2026-09-11");
		expect(archives[0].summary).toContain("David McGowan");
	});

	test("认不出版式的导出不会瞎编区间，标题退回只有昵称", async () => {
		stub = await startStubModel([
			{
				content: "",
				toolCalls: [
					{
						name: "ensure_contact",
						args: {
							name: "许东明",
							evidence: [{ kind: "wechat.chat", quote: "【姓名】许东明", ref: null }],
						},
					},
				],
			},
			{ content: "新建联系人许东明。" },
		]);
		useAgentEnv(stub.baseUrl);

		const result = await runIntake({ person: "许东明", file: "a.txt", text: SAMPLE });
		const archives = await intakeArchives(result.contactId ?? "");

		expect(archives[0].title).toBe("微信记录导入：许东明");
		expect(archives[0].title).not.toContain("条");
	});

	test("第二轮导入命中既有联系人时，留底照样挂到他身上", async () => {
		stub = await startStubModel(({ index }) =>
			index % 2 === 0
				? {
						content: "",
						toolCalls: [
							{
								name: "ensure_contact",
								args: {
									name: "许东明",
									wechat_id: "许东明",
									evidence: [{ kind: "wechat.chat", quote: "【姓名】许东明", ref: null }],
								},
							},
						],
					}
				: { content: "已确认这位联系人已在库中。" },
		);
		useAgentEnv(stub.baseUrl);

		const first = await runIntake({ person: "许东明", file: "a.txt", text: SAMPLE });
		const second = await runIntake({ person: "许东明", file: "b.txt", text: SAMPLE });

		expect(second.created.contacts).toHaveLength(0);
		expect(second.contactId).toBe(first.contactId);

		const [conversation] = await db()
			.select()
			.from(conversations)
			.where(eq(conversations.id, second.conversationId));
		expect(conversation.contactId).toBe(first.contactId);

		// 两次导入 = 两条留底，按导入时间倒序。
		const archives = await intakeArchives(first.contactId ?? "");
		expect(archives).toHaveLength(2);
		expect(archives[0].conversationId).toBe(second.conversationId);
	});

	test("第二条已有记录不会重复出现在 created 里", async () => {
		// 每次请求都先调 ensure_contact，第二轮再返回一段收尾文本。
		stub = await startStubModel(({ index }) =>
			index % 2 === 0
				? {
						content: "",
						toolCalls: [
							{
								name: "ensure_contact",
								args: {
									name: "许东明",
									wechat_id: "许东明",
									evidence: [{ kind: "wechat.chat", quote: "【姓名】许东明", ref: null }],
								},
							},
						],
					}
				: { content: "已确认这位联系人已在库中。" },
		);
		useAgentEnv(stub.baseUrl);

		const first = await runIntake({ person: "许东明", file: "a.txt", text: SAMPLE });
		expect(first.created.contacts).toHaveLength(1);

		// 第二次导入同一个人：应命中既有记录，不重复建。
		const second = await runIntake({ person: "许东明", file: "b.txt", text: SAMPLE });
		expect(second.created.contacts).toHaveLength(0);
		expect(second.counts.ensure_contact).toBe(1);
	});

	test("系统提示使用微信模式（不再声明没有微信数据）", async () => {
		stub = await startStubModel([{ content: "已处理。" }]);
		useAgentEnv(stub.baseUrl);

		await runIntake({ person: "许东明", file: "聊天记录.txt", text: SAMPLE });

		expect(stub.requests.length).toBeGreaterThan(0);
		expect(stub.requests[0].tools).toContain("ensure_contact");
		expect(stub.requests[0].tools).toContain("classify_role");
		expect(stub.requests[0].tools).toContain("propose_field");
	});

	test("智能体不可用时抛错，由端点层转成中文原因", async () => {
		delete process.env.ZAI_API_KEY;

		await expect(
			runIntake({ person: "许东明", file: null, text: SAMPLE }),
		).rejects.toThrow();
	});
});
