import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { runIntake, buildIntakeMessage } from "../agent/intake";
import type { DualTrackPayload, PlaybookPayload } from "../app/types/domain";
import { activities, contactFacts, contacts, conversations } from "../server/db/schema";
import { board } from "../server/utils/board";
import { closeDb, db } from "../server/utils/db";
import { allPromises } from "../server/utils/promises";
import { latestInsights } from "../server/utils/insights";
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

/** 黄金案例：Michael Wake 的聊天节选（尺寸被坑史、条款、物流延期与体谅）。 */
const GOLDEN_CHAT = `Michael Wake
[2026-09-25 21:25] Michael: I recently bought some glasses and the supplier lied about the size. I hope you are honest.
[2026-09-26 20:05] Michael: Thank you for the picture, this gives me confidence
[2026-09-27 10:02] Michael: yes 4GB ram, shipping to 51 Turnbury Park Drive, Jandakot WA 6164
[2026-09-27 11:40] Michael: Great review coming once delivered and verified
[2026-09-27 11:41] Michael: I will buy more if they are everything you say
[2026-10-13 09:10] Xia: I will give you 8% discount on your next order
[2026-10-13 09:12] Michael: A discount does not get me my glasses any sooner
[2026-10-13 09:15] Michael: I know you are trying, i am just frustrated`;

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

		// 第二次导入同一会话但带了新消息：指纹去重后模型只看到新增行，
		// ensure_contact 命中既有记录，不重复建。
		const second = await runIntake({
			person: "许东明",
			file: "b.txt",
			text: `${SAMPLE}\n[2026-10-16 09:00] 许东明: 收到，下周联络。`,
		});
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

	test("系统提示包含三层冰山与双向承诺的提取规范", async () => {
		stub = await startStubModel([{ content: "已处理。" }]);
		useAgentEnv(stub.baseUrl);

		await runIntake({ person: "许东明", file: "聊天记录.txt", text: SAMPLE });

		expect(stub.requests[0].tools).toContain("record_insight");
		expect(stub.requests[0].tools).toContain("record_promise");

		// 提示词正文里必须有透镜与双轨的关键词（从收到的 system 消息里核对）。
		const systemText = JSON.stringify(stub.requests[0].messages);
		expect(systemText).toContain("相处使用说明书");
		expect(systemText).toContain("双轨");
		expect(systemText).toContain("customer");
		// V2 迭代：白描、短标签、性格光谱与家常弹药库的提取规范也要进系统提示。
		expect(systemText).toContain("人物白描");
		expect(systemText).toContain("short_tags");
		expect(systemText).toContain("性格光谱");
		expect(systemText).toContain("家常弹药库");
	});

	test("黄金案例：Michael Wake 三层冰山 + 双向承诺 + 追踪任务", async () => {
		// 第一轮导入：建档。
		stub = await startStubModel([
			{
				content: "",
				toolCalls: [
					{
						name: "ensure_contact",
						args: {
							name: "Michael Wake",
							phone: "0430 466 100",
							evidence: [
								{
									kind: "wechat.chat",
									quote: "Michael Wake 0430 466 100",
									ref: "Michael@chat.txt",
									time: "2026-09-25 21:20",
								},
							],
						},
					},
				],
			},
			{ content: "新建联系人 Michael Wake。" },
		]);
		useAgentEnv(stub.baseUrl);

		const first = await runIntake({ person: "Michael Wake", file: "chat.txt", text: SAMPLE });
		const contactId = first.contactId ?? "";
		expect(contactId).toBeTruthy();

		// 第二轮导入：状态修正 + 三层洞察（V2 结构）+ 承诺账本 + 追踪任务。
		// 注意：对同一字段的两次 record_fact 必须拆进不同的工具步骤 ——
		// 同一步骤里的工具调用会被并行执行，两次并发写 address 的提交顺序不可控。
		stub = await startStubModel([
			{
				content: "",
				toolCalls: [
					{
						name: "ensure_contact",
						args: {
							name: "Michael Wake",
							evidence: [{ kind: "wechat.chat", quote: "Michael Wake", ref: null, time: null }],
						},
					},
					{
						// 认知刷新第一步：先写入旧认知（误报）。
						name: "record_fact",
						args: {
							contact_id: contactId,
							field: "address",
							value: "旧地址（误报 2GB 存储）",
							evidence: [
								{ kind: "wechat.chat", quote: "it has 2GB ram right?", ref: "Michael@chat.txt", time: "2026-09-25 21:30" },
							],
						},
					},
				],
			},
			{
				content: "",
				toolCalls: [
					{
						// 认知刷新第二步：后半段核实后修正 —— 服务端应覆盖而非追加矛盾值。
						name: "record_fact",
						args: {
							contact_id: contactId,
							field: "address",
							value: "51 Turnbury Park Drive, Jandakot, Western Australia, 6164",
							evidence: [
								{
									kind: "wechat.chat",
									quote: "yes 4GB ram, shipping to 51 Turnbury Park Drive, Jandakot WA 6164",
									ref: "Michael@chat.txt",
									time: "2026-09-27 10:02",
								},
							],
						},
					},
				],
			},
			{
				content: "",
				toolCalls: [
					{
						name: "record_insight",
						args: {
							contact_id: contactId,
							kind: "playbook",
							payload: {
								counterpart_type: "customer",
								executive_summary:
									"西澳珀斯的样品测试买家：被虚报尺寸坑出旧伤，极重规格与契约、只认眼见为实的证据；吃真诚共情、不吃折扣画饼——先给证据再谈感情。",
								short_tags: [
									"样品测试买家",
									"免税客户",
									"DDP包税条款",
									"西澳珀斯",
									"39mm小镜框基准",
									"眼见为实型",
								],
								personality_spectrums: {
									rigor_vs_flexibility: { score: 92, note: "规格差一点都要追问到底" },
									transactional_vs_relational: { score: 75, note: "会体谅人，但事必须办好" },
									trust_mechanism: { score: 95, note: "只认卡尺实测图与真人试戴视频" },
								},
								small_talk_playbook: {
									strategy_advice:
										"【熟化期·交付安抚】当前建议 40% 硬核物流真相 + 60% 真诚共情；待签收后切换为 30% 专业 + 70% 家常破冰。",
									personal_hooks: [
										{
											category: "个人装备/习惯",
											detail: "日常戴 Ray-Ban 39mm 太阳镜，小镜框是他的基准审美",
											quote: "I wear Ray-Ban 39mm",
											time: "2026-09-26 20:05",
										},
										{
											category: "共同幽默梗",
											detail: "调侃我方卡尺测量「手抖 shaky hands」，我方流汗拍照回图，他夸「Very handsome young man」",
											quote: "shaky hands haha",
											time: "2026-09-26 20:06",
										},
										{
											category: "温情互动",
											detail: "中秋节关心我方是否加班、有没有吃月饼",
											quote: "Do you eat mooncake during the festival?",
											time: "2026-09-25 21:30",
										},
										{
											category: "地域生活体感",
											detail: "身处西澳珀斯 Jandakot，对相隔 3500km 的东海岸墨尔本有距离痛感",
											quote: "Melbourne is so far from Perth",
											time: "2026-10-13 09:12",
										},
									],
									ready_to_use_icebreaker: {
										zh: "眼镜戴着还习惯吗？我记得你是 39mm 小框党，等这批到了，挑个周末戴去珀斯海边晒晒太阳。",
										en: "How are the glasses treating you? I remembered you are a 39mm guy — once this batch lands, take them out for a weekend by the coast in Perth.",
									},
								},
								business_value: [
									{
										title: "样品满意即批量复购",
										attribution: "自述核验达标就会加单，LTV 完全取决于这一单的交付质量。",
										confidence: 75,
										evidence_quote: "I will buy more if they are everything you say",
										evidence_time: "2026-09-27 11:41",
									},
								],
								pain_points: [
									{
										title: "被虚报尺寸坑过的旧伤",
										attribution: "上一家供应商谎报尺寸让他退货扯皮，对口头保证已免疫，只认可验证的证据。",
										confidence: 90,
										evidence_quote: "the supplier lied about the size. I hope you are honest",
										evidence_time: "2026-09-25 21:25",
									},
								],
								sweet_spots: [
									{
										title: "眼见为实瞬间建立信任",
										attribution: "卡尺实测图与真人试戴视频恰好补上他缺的安全感，坦诚的活人感比话术有效。",
										confidence: 85,
										evidence_quote: "Thank you for the picture, this gives me confidence",
										evidence_time: "2026-09-26 20:05",
									},
								],
								taboos: [
									{
										title: "问题未解决时反感折扣画饼",
										attribution: "延误期里他要的是货与时间线，折扣会被解读为敷衍与转移话题。",
										confidence: 95,
										evidence_quote: "A discount does not get me my glasses any sooner",
										evidence_time: "2026-10-13 09:12",
									},
								],
							},
							evidence: [
								{ kind: "wechat.chat", quote: "the supplier lied about the size", ref: "Michael@chat.txt", time: "2026-09-25 21:25" },
							],
						},
					},
					{
						name: "record_insight",
						args: {
							contact_id: contactId,
							kind: "dual_track",
							payload: {
								transaction_health: {
									level: "Frustrated",
									score: -60,
									note: "发货第 15 天仍未收到，物流绕道墨尔本",
									quote: "i am just frustrated",
									time: "2026-10-13 09:15",
								},
								personal_trust: {
									level: "High",
									score: 70,
									note: "虽不满物流但明确体谅我方的努力",
									quote: "I know you are trying, i am just frustrated",
									time: "2026-10-13 09:15",
								},
							},
							evidence: [
								{ kind: "wechat.chat", quote: "I know you are trying, i am just frustrated", ref: "Michael@chat.txt", time: "2026-10-13 09:15" },
							],
						},
					},
				],
			},
			{
				content: "",
				toolCalls: [
					{
						name: "record_promise",
						args: {
							contact_id: contactId,
							direction: "ours",
							title: "每日盯物流并在到达/派送时立即通知",
							due_hint: "到达/派送时",
							evidence: [{ kind: "wechat.chat", quote: "I will watch the tracking daily and tell you the moment it arrives", ref: "Michael@chat.txt", time: "2026-10-13 09:13" }],
						},
					},
					{
						name: "record_promise",
						args: {
							contact_id: contactId,
							direction: "ours",
							title: "下一单给 8% 折扣补偿",
							due_hint: "下一单",
							evidence: [{ kind: "wechat.chat", quote: "I will give you 8% discount on your next order", ref: "Michael@chat.txt", time: "2026-10-13 09:10" }],
						},
					},
					{
						name: "record_promise",
						args: {
							contact_id: contactId,
							direction: "ours",
							title: "未来订单改香港直飞珀斯航线，不再绕道墨尔本",
							evidence: [{ kind: "wechat.chat", quote: "next time we will ship HK direct to Perth", ref: "Michael@chat.txt", time: "2026-10-13 09:11" }],
						},
					},
					{
						name: "record_promise",
						args: {
							contact_id: contactId,
							direction: "theirs",
							title: "签收核验后给好评",
							due_hint: "签收核验后",
							evidence: [{ kind: "wechat.chat", quote: "Great review coming once delivered and verified", ref: "Michael@chat.txt", time: "2026-09-27 11:40" }],
						},
					},
					{
						name: "record_promise",
						args: {
							contact_id: contactId,
							direction: "theirs",
							title: "样品满意后下批量单",
							due_hint: "样品签收3天后跟进反馈",
							evidence: [{ kind: "wechat.chat", quote: "I will buy more if they are everything you say", ref: "Michael@chat.txt", time: "2026-09-27 11:41" }],
						},
					},
					{
						name: "create_activity",
						args: {
							kind: "task",
							title: "盯控澳邮单号 33YWU303449101000931506 跨州陆运，扫出珀斯节点立即通知 Michael",
							body: "墨尔本清关后转澳洲邮政陆运，连续几天无扫描更新，客户处于交付焦虑期。",
							contact_id: contactId,
							due_at: "2026-10-16T09:00:00+08:00",
						},
					},
				],
			},
			{ content: "已修正 Michael Wake 的地址认知，写入相处说明书（含性格光谱与家常弹药库）与双轨温度，记录 5 条双向承诺，并建 1 条物流追踪任务。" },
		]);
		useAgentEnv(stub.baseUrl);

		const second = await runIntake({ person: "Michael Wake", file: "chat-2.txt", text: GOLDEN_CHAT });
		expect(second.contactId).toBe(contactId);
		expect(second.counts.record_insight).toBe(2);
		expect(second.counts.record_promise).toBe(5);

		// 硬事实：认知刷新生效 —— 新值覆盖旧值，旧行 superseded，不留矛盾双值。
		const [row] = await db().select().from(contacts).where(eq(contacts.id, contactId));
		expect(row.address).toBe("51 Turnbury Park Drive, Jandakot, Western Australia, 6164");

		const facts = await db().select().from(contactFacts).where(eq(contactFacts.contactId, contactId));
		expect(facts).toHaveLength(2);
		const applied = facts.find((fact) => fact.status === "applied");
		const superseded = facts.find((fact) => fact.status === "superseded");
		expect(applied?.value).toContain("51 Turnbury Park Drive");
		expect(superseded?.value).toContain("误报");

		// 原话证据锚点：时间戳随事实入库。
		expect((applied?.evidence as { time: string | null }[])[0]?.time).toBe("2026-09-27 10:02");

		// 第二层 + 第三层：两版洞察落库，且带对象类型与双轨。
		const insights = await latestInsights(contactId);
		expect(insights).toHaveLength(2);
		const playbookInsight = insights.find((item) => item.kind === "playbook");
		const dualTrack = insights.find((item) => item.kind === "dual_track");
		const playbookPayload = playbookInsight?.payload as PlaybookPayload;
		expect(playbookPayload.counterpart_type).toBe("customer");

		// V2 顶层：人物白描、短标签、性格光谱、家常弹药库。
		expect(playbookPayload.executive_summary).toContain("珀斯");
		expect(playbookPayload.executive_summary).toContain("旧伤");
		expect(playbookPayload.short_tags.length).toBeGreaterThanOrEqual(4);
		expect(playbookPayload.short_tags.every((tag) => tag.length <= 10)).toBe(true);
		expect(playbookPayload.personality_spectrums?.trust_mechanism.score).toBe(95);
		expect(playbookPayload.personality_spectrums?.rigor_vs_flexibility.score).toBe(92);

		const smallTalk = playbookPayload.small_talk_playbook;
		expect(smallTalk?.personal_hooks.length).toBeGreaterThanOrEqual(3);
		expect(smallTalk?.personal_hooks[0]?.category).toBe("个人装备/习惯");
		expect(smallTalk?.strategy_advice).toContain("40%");
		expect(smallTalk?.ready_to_use_icebreaker?.zh).toContain("39mm");
		expect(smallTalk?.ready_to_use_icebreaker?.en).toContain("Perth");

		// V2 条目：短标题 + 深层归因 + 置信度 + 原话证据。
		const taboo = playbookPayload.taboos[0];
		expect(taboo?.title).toBe("问题未解决时反感折扣画饼");
		expect(taboo?.attribution).toContain("敷衍");
		expect(taboo?.confidence).toBe(95);
		expect(taboo?.quote).toContain("A discount does not get me my glasses");
		expect(taboo?.time).toBe("2026-10-13 09:12");

		const dualPayload = dualTrack?.payload as DualTrackPayload;
		expect(dualPayload.transaction_health.score).toBeLessThan(0);
		expect(dualPayload.personal_trust.score).toBeGreaterThan(0);

		// 双向承诺账本：3 条我方欠 + 2 条对方许，全部 open。
		const ledger = await allPromises(contactId);
		expect(ledger).toHaveLength(5);
		expect(ledger.filter((item) => item.direction === "ours")).toHaveLength(3);
		expect(ledger.filter((item) => item.direction === "theirs")).toHaveLength(2);
		expect(ledger.every((item) => item.status === "open")).toBe(true);
		expect(ledger.find((item) => item.title.includes("8%"))?.dueHint).toBe("下一单");

		// 承诺与任务自动进看板：事务健康度 Frustrated 时，「每日盯物流并立即通知」
		// 必须强制进第一象限（实机 Bug 的端到端复现）；远期折扣承诺保留在第二象限。
		const boardResult = await board();
		const dailyWatch = boardResult.columns
			.find((column) => column.quadrant === "urgent_important")
			?.items.find((item) => item.type === "promise" && item.title.includes("每日盯物流"));
		expect(dailyWatch).toBeTruthy();
		expect(dailyWatch?.badge).toContain("Frustrated");

		const discountPromise = boardResult.columns
			.find((column) => column.quadrant === "important")
			?.items.find((item) => item.type === "promise" && item.title.includes("8%"));
		expect(discountPromise).toBeTruthy();

		const taskRows = await db()
			.select()
			.from(activities)
			.where(and(eq(activities.contactId, contactId), eq(activities.kind, "task")));
		expect(taskRows).toHaveLength(1);
		expect(taskRows[0].title).toContain("33YWU303449101000931506");
		expect(taskRows[0].dueAt).not.toBeNull();
	});

	test("智能体不可用时抛错，由端点层转成中文原因", async () => {
		delete process.env.ZAI_API_KEY;

		await expect(
			runIntake({ person: "许东明", file: null, text: SAMPLE }),
		).rejects.toThrow();
	});
});
