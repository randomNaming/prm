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
		researchKind: "research_contact",
		companyResearchKind: "research_company",
		recheckKind: "recheck",
	},

	agent: {
		maxSteps: 8,
		maxOutputTokens: 8000,
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
		recentActivityLimit: 20,
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

	time: {
		secondMs: SECOND_MS,
		minuteMs: MINUTE_MS,
		dayMs: DAY_MS,
	},
} as const;
