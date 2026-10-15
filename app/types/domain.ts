export const DEAL_STAGES = [
	"初步接触",
	"需求确认",
	"方案报价",
	"谈判",
	"成交",
	"搁置",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const OPEN_STAGES = ["初步接触", "需求确认", "方案报价", "谈判"] as const;

export const DEAL_STATUSES = ["open", "won", "shelved"] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
	open: "推进中",
	won: "已成交",
	shelved: "已搁置",
};

export function dealStatusOfStage(stage: DealStage): DealStatus {
	if (stage === "成交") return "won";
	if (stage === "搁置") return "shelved";
	return "open";
}

export const ACTIVITY_KINDS = ["note", "task", "stage_change", "email", "chat_log"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
	note: "备注",
	task: "任务",
	stage_change: "阶段变更",
	email: "邮件",
	chat_log: "聊天导入",
};

/** 只读活动：由服务端在导入完成时写入，界面上不提供编辑入口。 */
export const READONLY_ACTIVITY_KINDS: readonly ActivityKind[] = ["stage_change", "chat_log"];

/**
 * 关系维护里唯一带联动的那一项：选中它才展开「修复说明」。
 *
 * 下拉选项本身登记在 field_defs（可以自己加词），但「哪一项要展开说明」是界面行为，
 * 只能写在代码里，所以这里固定一个字符串当契约，前后端与字段种子共用它。
 */
export const RELATIONSHIP_REPAIR = "关系待修复";

/**
 * 按「关系维护」筛选时，用它表示「留空」那一档 ——
 * 也就是长期养着、可以直接丢进群发池的人。
 */
export const RELATIONSHIP_BLANK = "__blank__";

/**
 * 四象限（艾森豪威尔矩阵）。
 *
 * 键用 ASCII、标签用中文：象限会被拖拽落到 `board_pins` 表里，
 * 值一旦写进库就不该随文案改动而失效。
 */
export const BOARD_QUADRANTS = [
	"urgent_important",
	"important",
	"urgent",
	"neither",
] as const;

export type BoardQuadrant = (typeof BOARD_QUADRANTS)[number];

export const BOARD_QUADRANT_LABELS: Record<BoardQuadrant, string> = {
	urgent_important: "紧急且重要",
	important: "重要不紧急",
	urgent: "紧急不重要",
	neither: "不重要不紧急",
};

export const BOARD_ITEM_TYPES = ["task", "deal", "contact"] as const;

export type BoardItemType = (typeof BOARD_ITEM_TYPES)[number];

export type BoardItem = {
	type: BoardItemType;
	id: string;
	/** 卡片主标题。 */
	title: string;
	/** 副标题：谁、什么阶段、哪种标记。 */
	detail: string | null;
	/** 角标：逾期几天、停滞几天。 */
	badge: string | null;
	/** 点进去看哪条记录。 */
	to: string;
	/** 生效象限（手工拖动优先于推断）。 */
	quadrant: BoardQuadrant;
	/** 系统推断出来的象限，用来判断「是否被手工改过」。 */
	inferred: BoardQuadrant;
	/** 是否被手工拖过。 */
	pinned: boolean;
	/** 排序用：越大越靠前。 */
	weight: number;
};

export type BoardColumn = {
	quadrant: BoardQuadrant;
	label: string;
	items: BoardItem[];
};

export type Board = {
	columns: BoardColumn[];
	/** 被手工拖过的事项数，用来提示「有几个是你自己摆的」。 */
	pinnedCount: number;
};

export const FACT_FIELDS = [
	"title",
	"email",
	"phone",
	"wechat_id",
	"address",
	"country",
	"postal_code",
	"linkedin",
	"github",
] as const;

export type FactField = (typeof FACT_FIELDS)[number];

export const FACT_FIELD_LABELS: Record<FactField, string> = {
	title: "职位",
	email: "邮箱",
	phone: "电话",
	wechat_id: "微信号",
	address: "地址",
	country: "国家",
	postal_code: "邮编",
	linkedin: "领英主页",
	github: "GitHub 主页",
};

export const COMPANY_FACT_FIELDS = ["industry", "description", "address", "domain"] as const;

export type CompanyFactField = (typeof COMPANY_FACT_FIELDS)[number];

export const COMPANY_FACT_FIELD_LABELS: Record<CompanyFactField, string> = {
	industry: "行业",
	description: "主营介绍",
	address: "公司地址",
	domain: "官网域名",
};

export const FACT_STATUSES = ["applied", "proposed", "dismissed", "superseded"] as const;

export type FactStatus = (typeof FACT_STATUSES)[number];

export const FACT_STATUS_LABELS: Record<FactStatus, string> = {
	applied: "已写入",
	proposed: "待确认",
	dismissed: "已拒绝",
	superseded: "已被替换",
};

export const FIELD_SCOPES = ["contact", "company"] as const;

export type FieldScope = (typeof FIELD_SCOPES)[number];

export const FIELD_SCOPE_LABELS: Record<FieldScope, string> = {
	contact: "联系人",
	company: "公司",
};

export const FIELD_STATUSES = ["active", "proposed", "dismissed"] as const;

export type FieldStatus = (typeof FIELD_STATUSES)[number];

export const FIELD_STATUS_LABELS: Record<FieldStatus, string> = {
	active: "已生效",
	proposed: "待确认",
	dismissed: "已拒绝",
};

export const FIELD_ORIGINS = ["builtin", "agent", "human"] as const;

export type FieldOrigin = (typeof FIELD_ORIGINS)[number];

export type FieldDef = {
	id: string;
	scope: FieldScope;
	key: string;
	label: string;
	aliases: string[];
	options: string[];
	dataType: string;
	origin: FieldOrigin;
	status: FieldStatus;
	agentWritable: boolean;
	sampleValue: string | null;
	sampleRef: string | null;
	evidence: Evidence[] | null;
	decidedAt: number | null;
	createdAt: number;
	updatedAt: number;
};

export type Evidence = {
	kind: string;
	quote: string;
	ref: string | null;
};

export type Contact = {
	id: string;
	companyId: string | null;
	firstName: string;
	lastName: string | null;
	title: string | null;
	email: string | null;
	phone: string | null;
	wechatId: string | null;
	address: string | null;
	/** 国家：标准中文国名，下拉数据源在 app/utils/countries.ts。 */
	country: string | null;
	/** 邮编。 */
	postalCode: string | null;
	businessRole: string | null;
	/** 关系维护。留空 = 正常关系，进「长期养着」的池子（节日问候、群发营销）。 */
	relationshipState: string | null;
	/** 关系待修复时手写的内容：要修什么、等到什么条件。 */
	repairNote: string | null;
	linkedin: string | null;
	github: string | null;
	notes: string | null;
	archivedAt: number | null;
	lastResearchedAt: number | null;
	createdAt: number;
	updatedAt: number;
};

export type Company = {
	id: string;
	name: string;
	domain: string | null;
	industry: string | null;
	address: string | null;
	cooperationRole: string | null;
	description: string | null;
	source: string | null;
	archivedAt: number | null;
	createdAt: number;
	updatedAt: number;
};

export type Deal = {
	id: string;
	name: string;
	companyId: string | null;
	contactId: string | null;
	stage: DealStage;
	expectedCloseDate: string | null;
	status: DealStatus;
	stageChangedAt: number | null;
	archivedAt: number | null;
	createdAt: number | null;
	updatedAt: number | null;
};

export type Activity = {
	id: string;
	kind: ActivityKind;
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
	title: string;
	body: string | null;
	dueAt: number | null;
	completedAt: number | null;
	createdAt: number;
};

export type ContactFact = {
	id: string;
	contactId: string;
	field: string;
	value: string;
	status: FactStatus;
	evidence: Evidence[];
	source: string;
	decidedAt: number | null;
	createdAt: number;
};

export type CompanyFact = {
	id: string;
	companyId: string;
	field: string;
	value: string;
	status: FactStatus;
	evidence: Evidence[];
	source: string;
	decidedAt: number | null;
	createdAt: number;
};

export type TaskPayload = {
	reason: string | null;
	days: number | null;
};

export type AgentTask = {
	id: string;
	kind: string;
	targetType: string | null;
	targetId: string | null;
	payload: TaskPayload | null;
	status: string;
	priority: number;
	attempts: number;
	maxAttempts: number;
	runAt: number;
	finishedAt: number | null;
	error: string | null;
	createdAt: number;
};

export type Conversation = {
	id: string;
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
	title: string | null;
	createdAt: number | null;
	lastMessageAt: number | null;
};

export type ChatMessage = {
	id: string;
	conversationId: string;
	role: string;
	content: string | null;
	reasoning: string | null;
	toolCalls: ChatToolCall[] | null;
	createdAt: number;
};

export type ChatToolCall = {
	name: string;
	input: unknown;
	result: unknown;
};

export type DashboardDeal = {
	id: string;
	name: string;
	stage: DealStage;
	companyName: string | null;
	stageChangedAt: number | null;
	expectedCloseDate: string | null;
};

export type DashboardTask = {
	id: string;
	title: string;
	dueAt: number | null;
	contactId: string | null;
	contactName: string | null;
};

export type DashboardActivity = {
	id: string;
	kind: ActivityKind;
	title: string;
	body: string | null;
	createdAt: number;
	contactId: string | null;
	contactName: string | null;
};

export type Dashboard = {
	deals: DashboardDeal[];
	tasks: DashboardTask[];
	activities: DashboardActivity[];
};

export type QueueStatus = {
	pending: number;
	running: number;
	failed: number;
	agentEnabled: boolean;
	agentReason: string;
	model: string;
};

/**
 * 一次聊天导入留下的只读留底。
 *
 * 原文本身存在 messages 里（对话的 user 消息），这里只带出「什么时候导的、导的哪份文件、
 * 覆盖了哪段时间」这些索引信息，好让二次激活时先看时间差，再决定要不要翻全文。
 */
export type IntakeArchive = {
	conversationId: string;
	/** 会话标题，形如「微信记录导入：David McGowan（126 条，2026-08-18 ~ 2026-10-13）」。 */
	title: string;
	importedAt: number;
	/** null = 还没看过（详情页「聊天留底」标签上的红点）。 */
	viewedAt: number | null;
	/** 智能体这一轮的中文摘要。 */
	summary: string | null;
};

export type ContactDetail = {
	contact: Contact;
	company: Company | null;
	deals: Deal[];
	activities: Activity[];
	facts: ContactFact[];
	researching: boolean;
	/** 这个联系人身上历次聊天导入的留底，按导入时间倒序。 */
	archives: IntakeArchive[];
};

export type CompanyDetail = {
	company: Company;
	contacts: Contact[];
	deals: Deal[];
	activities: Activity[];
	facts: CompanyFact[];
	researching: boolean;
};

export type DealDetail = {
	deal: Deal;
	company: Company | null;
	contact: Contact | null;
	activities: Activity[];
};

/**
 * 列表行的额外承载字段。
 *
 * 列表比详情多两件事：跨表要展示的字段（联系人看公司名、公司看联系人数），
 * 以及自定义字段的当前值 —— 后者没有对应数据库列，只能从事实表带出来。
 */
export type ContactListItem = Contact & {
	companyName: string | null;
	/** 键为 field_defs.key，值是该记录上已生效的字段值。 */
	facts: Record<string, string>;
};

export type CompanyListItem = Company & {
	contactCount: number;
	facts: Record<string, string>;
};

export type Page<T> = {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
};

export type McpEnvSource = "env" | "file" | "missing";

export type McpEnvItem = {
	key: string;
	required: boolean;
	description: string;
	value: string;
	source: McpEnvSource;
};

export type McpSnippet = {
	label: string;
	where: string;
	json: string;
};

export type McpTool = {
	name: string;
	summary: string;
};

export type McpServerInfo = {
	id: string;
	name: string;
	direction: string;
	summary: string;
	packageDir: string;
	entry: string;
	entryExists: boolean;
	envFile: string;
	envFileExists: boolean;
	env: McpEnvItem[];
	tools: McpTool[];
	snippets: McpSnippet[];
	buildCommands: string[];
	blockers: string[];
	ready: boolean;
};

export type McpOverview = {
	platformBaseUrl: string;
	root: string;
	servers: McpServerInfo[];
	notes: string[];
};

export type SearchHit = {
	type: "contact" | "company" | "deal";
	id: string;
	label: string;
	detail: string;
};
