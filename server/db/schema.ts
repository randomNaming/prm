import {
	bigint,
	char,
	foreignKey,
	index,
	int,
	json,
	mediumtext,
	mysqlTable,
	primaryKey,
	text,
	uniqueIndex,
	varchar,
} from "drizzle-orm/mysql-core";

export const companies = mysqlTable(
	"companies",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		name: varchar("name", { length: 191 }).notNull(),
		domain: varchar("domain", { length: 191 }),
		industry: varchar("industry", { length: 191 }),
		address: varchar("address", { length: 191 }),
		cooperationRole: varchar("cooperation_role", { length: 32 }),
		description: text("description"),
		source: varchar("source", { length: 64 }),
		archivedAt: bigint("archived_at", { mode: "number" }),
		createdAt: bigint("created_at", { mode: "number" }).notNull(),
		updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
	},
	(table) => [index("companies_name").on(table.name)],
);

export const contacts = mysqlTable(
	"contacts",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		companyId: varchar("company_id", { length: 36 }),
		firstName: varchar("first_name", { length: 191 }).notNull(),
		lastName: varchar("last_name", { length: 191 }),
		title: varchar("title", { length: 191 }),
		email: varchar("email", { length: 191 }),
		phone: varchar("phone", { length: 64 }),
		wechatId: varchar("wechat_id", { length: 191 }),
		address: varchar("address", { length: 191 }),
		businessRole: varchar("business_role", { length: 32 }),
		/** 关系维护：留空 = 默认（长期养着的池子）。 */
		relationshipState: varchar("relationship_state", { length: 32 }),
		/** 选了「关系待修复」时，人工写清要修什么。 */
		repairNote: varchar("repair_note", { length: 191 }),
		linkedin: varchar("linkedin", { length: 191 }),
		github: varchar("github", { length: 191 }),
		notes: text("notes"),
		archivedAt: bigint("archived_at", { mode: "number" }),
		lastResearchedAt: bigint("last_researched_at", { mode: "number" }),
		createdAt: bigint("created_at", { mode: "number" }).notNull(),
		updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "fk_contacts_company",
			columns: [table.companyId],
			foreignColumns: [companies.id],
		}).onDelete("set null"),
		index("contacts_company").on(table.companyId),
		index("contacts_email").on(table.email),
		index("contacts_wechat").on(table.wechatId),
	],
);

export const deals = mysqlTable(
	"deals",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		name: varchar("name", { length: 191 }).notNull(),
		companyId: varchar("company_id", { length: 36 }),
		contactId: varchar("contact_id", { length: 36 }),
		stage: varchar("stage", { length: 32 }).notNull().default("初步接触"),
		amount: bigint("amount", { mode: "number" }),
		expectedCloseDate: char("expected_close_date", { length: 10 }),
		status: varchar("status", { length: 16 }).notNull().default("open"),
		stageChangedAt: bigint("stage_changed_at", { mode: "number" }),
		archivedAt: bigint("archived_at", { mode: "number" }),
		createdAt: bigint("created_at", { mode: "number" }),
		updatedAt: bigint("updated_at", { mode: "number" }),
	},
	(table) => [
		foreignKey({
			name: "fk_deals_company",
			columns: [table.companyId],
			foreignColumns: [companies.id],
		}).onDelete("set null"),
		foreignKey({
			name: "fk_deals_contact",
			columns: [table.contactId],
			foreignColumns: [contacts.id],
		}).onDelete("set null"),
		index("deals_status_stage").on(table.status, table.stage),
	],
);

export const activities = mysqlTable(
	"activities",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		kind: varchar("kind", { length: 32 }).notNull(),
		contactId: varchar("contact_id", { length: 36 }),
		companyId: varchar("company_id", { length: 36 }),
		dealId: varchar("deal_id", { length: 36 }),
		title: varchar("title", { length: 191 }).notNull(),
		body: text("body"),
		dueAt: bigint("due_at", { mode: "number" }),
		completedAt: bigint("completed_at", { mode: "number" }),
		createdAt: bigint("created_at", { mode: "number" }).notNull(),
	},
	(table) => [
		index("activities_due").on(table.dueAt),
		index("activities_contact").on(table.contactId, table.createdAt),
	],
);

export const contactFacts = mysqlTable(
	"contact_facts",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		contactId: varchar("contact_id", { length: 36 }).notNull(),
		field: varchar("field", { length: 32 }).notNull(),
		value: text("value").notNull(),
		status: varchar("status", { length: 16 }).notNull(),
		evidence: json("evidence").notNull(),
		source: varchar("source", { length: 16 }).notNull(),
		decidedAt: bigint("decided_at", { mode: "number" }),
		createdAt: bigint("created_at", { mode: "number" }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "fk_facts_contact",
			columns: [table.contactId],
			foreignColumns: [contacts.id],
		}).onDelete("cascade"),
		index("facts_contact_field").on(table.contactId, table.field, table.status),
	],
);

export const companyFacts = mysqlTable(
	"company_facts",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		companyId: varchar("company_id", { length: 36 }).notNull(),
		field: varchar("field", { length: 32 }).notNull(),
		value: text("value").notNull(),
		status: varchar("status", { length: 16 }).notNull(),
		evidence: json("evidence").notNull(),
		source: varchar("source", { length: 16 }).notNull(),
		decidedAt: bigint("decided_at", { mode: "number" }),
		createdAt: bigint("created_at", { mode: "number" }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "fk_company_facts_company",
			columns: [table.companyId],
			foreignColumns: [companies.id],
		}).onDelete("cascade"),
		index("company_facts_field").on(table.companyId, table.field, table.status),
	],
);

export const fieldDefs = mysqlTable(
	"field_defs",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		scope: varchar("scope", { length: 16 }).notNull(),
		key: varchar("key", { length: 64 }).notNull(),
		label: varchar("label", { length: 64 }).notNull(),
		aliases: json("aliases").notNull(),
		options: json("options"),
		dataType: varchar("data_type", { length: 16 }).notNull().default("text"),
		origin: varchar("origin", { length: 16 }).notNull(),
		status: varchar("status", { length: 16 }).notNull(),
		agentWritable: int("agent_writable").notNull().default(1),
		sampleValue: text("sample_value"),
		sampleRef: varchar("sample_ref", { length: 36 }),
		evidence: json("evidence"),
		decidedAt: bigint("decided_at", { mode: "number" }),
		createdAt: bigint("created_at", { mode: "number" }).notNull(),
		updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
	},
	(table) => [
		uniqueIndex("field_defs_scope_key").on(table.scope, table.key),
		index("field_defs_scope_status").on(table.scope, table.status),
	],
);

/**
 * 四象限看板的手工覆盖。
 *
 * 象限本身是自动推断的（逾期任务=紧急、停滞商机=紧急、关系维护=不重要不紧急），
 * 这张表只存「拖动过的那些」，让手工判断盖过推断。
 * 没有对应记录 = 未拖动，跟着推断走，所以删掉一行就等于恢复自动。
 */
export const boardPins = mysqlTable(
	"board_pins",
	{
		itemType: varchar("item_type", { length: 16 }).notNull(),
		itemId: varchar("item_id", { length: 36 }).notNull(),
		quadrant: varchar("quadrant", { length: 24 }).notNull(),
		updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.itemType, table.itemId] })],
);

export const agentTasks = mysqlTable(
	"agent_tasks",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		kind: varchar("kind", { length: 32 }).notNull(),
		targetType: varchar("target_type", { length: 32 }),
		targetId: varchar("target_id", { length: 36 }),
		payload: json("payload"),
		status: varchar("status", { length: 16 }).notNull().default("pending"),
		priority: int("priority").notNull().default(100),
		attempts: int("attempts").notNull().default(0),
		maxAttempts: int("max_attempts").notNull().default(3),
		leaseUntil: bigint("lease_until", { mode: "number" }),
		runAt: bigint("run_at", { mode: "number" }).notNull(),
		finishedAt: bigint("finished_at", { mode: "number" }),
		error: text("error"),
		createdAt: bigint("created_at", { mode: "number" }).notNull(),
	},
	(table) => [index("tasks_due").on(table.status, table.runAt, table.priority)],
);

export const conversations = mysqlTable(
	"conversations",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		contactId: varchar("contact_id", { length: 36 }),
		companyId: varchar("company_id", { length: 36 }),
		dealId: varchar("deal_id", { length: 36 }),
		title: varchar("title", { length: 191 }),
		createdAt: bigint("created_at", { mode: "number" }),
		lastMessageAt: bigint("last_message_at", { mode: "number" }),
	},
	(table) => [index("conversations_contact").on(table.contactId)],
);

export const messages = mysqlTable(
	"messages",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		conversationId: varchar("conversation_id", { length: 36 }).notNull(),
		role: varchar("role", { length: 16 }).notNull(),
		content: mediumtext("content"),
		reasoning: mediumtext("reasoning"),
		toolCalls: json("tool_calls"),
		createdAt: bigint("created_at", { mode: "number" }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "fk_messages_conversation",
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
		}).onDelete("cascade"),
		index("messages_conversation").on(table.conversationId, table.createdAt),
	],
);
