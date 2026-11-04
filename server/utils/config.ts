const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const CONFIG = {
	db: {
		connectionLimit: 5,
		connectTimeoutMs: 10 * SECOND_MS,
	},

	queue: {
		tickMs: 1 * MINUTE_MS,
		leaseMs: 5 * MINUTE_MS,
		maxAttempts: 3,
		batchPerTick: 1,
		rateWindowMs: 1 * MINUTE_MS,
		rateWindowLimit: 3,
		// 一轮 tick 超过这么久还没结束（模型请求被吊住等极端情况），
		// 看门狗强制解锁队列，让后续 tick 恢复认领 —— 宁可任务重试，不许队列死锁。
		stuckTickMs: 30 * MINUTE_MS,
		researchKind: "research_contact",
		companyResearchKind: "research_company",
		recheckKind: "recheck",
	},

	agent: {
		maxSteps: 12,
		// 三层冰山提取一轮要吐大量工具调用参数（事实 + 说明书 JSON + 承诺账本 + 任务），
		// GLM 的思考（reasoning）也计入输出预算：8000 的时代大批次会以 finishReason=length 中途夭折。
		// 已实测智谱端点接受 32000。
		maxOutputTokens: 32000,
		// 单次模型 HTTP 请求的硬超时（agent/model.ts 的 limitedFetch 按请求计时）：
		// 远端吊住请求时不能让一次研究把整个队列挂死。整轮多步分析的总时长不受它限制。
		requestTimeoutMs: 5 * 60_000,
		historyMessages: 40,
		maxRetries: 2,
	},

	research: {
		defaultRecheckDays: 7,
		minRecheckDays: 1,
		maxRecheckDays: 365,
	},

	lists: {
		pageSize: 20,
		maxPageSize: 100,
		recentActivityLimit: 10,
		timelineLimit: 50,
		maxSearchLength: 64,
	},

	board: {
		/** 商机在同一个阶段停留超过这么多天，自动判为「紧急」——该推一下或者干脆关掉。 */
		stalledDealDays: 14,
		/** 每个象限最多渲染多少条，避免首页被刷爆。 */
		maxItemsPerQuadrant: 30,
		/** 汇总时每类最多取多少条。 */
		taskLimit: 100,
		dealLimit: 100,
		contactLimit: 100,
		/** 开放承诺进看板的条数上限。 */
		promiseLimit: 30,
	},

	text: {
		maxNameLength: 191,
		maxFieldLength: 191,
		maxNoteLength: 4000,
		maxQuoteLength: 500,
	},

	intake: {
		/** 单次导入的聊天记录原文上限（字符）。超过则要求分批转发。 */
		maxTextLength: 50000,
		/** 单个会话一次导入约定的建议批量，超过会在返回里提示分批。 */
		suggestBatchSize: 20000,
	},

	cache: {
		agentStatusMs: 5 * SECOND_MS,
	},

	/** 名片识图（v1.1）：收图 → 视觉模型 → 草稿 → 人确认才进 contacts。 */
	card: {
		/** 一次综合识别最多几张（正面 + 背面）。 */
		maxImages: 2,
		/** 单张图片 base64 字符数上限（对应约 2.2MB 原图）。 */
		maxImageBase64Chars: 3 * 1024 * 1024,
		/** 单次请求全部图片 base64 合计上限。 */
		maxTotalBase64Chars: 6 * 1024 * 1024,
		/** 草稿统一保留 1 天：pending 超期自动作废，已处理的清理。 */
		retentionMs: 1 * DAY_MS,
		/** 限流窗口：每设备 10 次、全局 60 次。 */
		rateWindowMs: 1 * MINUTE_MS,
		ratePerDevice: 10,
		rateGlobal: 60,
		/** evidence 原文片段的截断长度。 */
		maxEvidenceChars: 60,
		/** raw_text 落库截断长度。 */
		maxRawTextChars: 20000,
		/** 端上补充文本（OCR/手输）长度上限。 */
		maxHintTextChars: 2000,
		/** 待确认列表默认与最大条数。 */
		draftListDefault: 20,
		draftListMax: 100,
	},

	time: {
		secondMs: SECOND_MS,
		minuteMs: MINUTE_MS,
		dayMs: DAY_MS,
	},
} as const;
