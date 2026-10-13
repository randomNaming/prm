import { tool } from "ai";
import { z } from "zod";
import { ACTIVITY_KINDS, FIELD_SCOPES } from "../app/types/domain";
import { createActivity } from "../server/utils/activities";
import { companyDetail, ensureCompany } from "../server/utils/companies";
import { recordCompanyFact } from "../server/utils/company-facts";
import { CONFIG } from "../server/utils/config";
import { addFieldOption, findFieldDef, proposeField } from "../server/utils/fields";
import { roleClassifier } from "./role-classifier";
import { contactDetail, ensureContact, linkContactCompany } from "../server/utils/contacts";
import { dealDetail } from "../server/utils/deals";
import { recordFact } from "../server/utils/facts";
import { scheduleRecheck } from "../server/utils/queue";
import { searchCrm } from "../server/utils/search";

function iso(value: number | null | undefined): string | null {	return value === null || value === undefined ? null : new Date(value).toISOString();
}

const evidenceSchema = z.object({
	kind: z
		.string()
		.trim()
		.min(1)
		.describe("来源类型，例如 crm.note、crm.activity、crm.contact、wechat.chat"),
	quote: z.string().trim().min(1).describe("库内原文摘录，必须逐字来自 CRM 数据"),
	ref: z.string().trim().max(191).nullish().describe("出处：记录 id 或活动标题"),
});

export function crmTools() {
	return {
		read_contact: tool({
			description:
				"读取一位联系人的全貌：字段、所属公司与公司 id、相关商机及 id、最近活动、字段事实。回答关于某个人的问题前先调它。",
			inputSchema: z.object({ contact_id: z.string().trim().min(1) }),
			execute: async ({ contact_id }) => {
				const detail = await contactDetail(contact_id);
				if (!detail) return { found: false, reason: "没有这位联系人。" };

				return {
					found: true,
					contact: {
						id: detail.contact.id,
						name: `${detail.contact.firstName}${detail.contact.lastName ?? ""}`,
						title: detail.contact.title,
						email: detail.contact.email,
						phone: detail.contact.phone,
						wechat_id: detail.contact.wechatId,
						address: detail.contact.address,
						linkedin: detail.contact.linkedin,
						github: detail.contact.github,
						notes: detail.contact.notes,
						created_at: iso(detail.contact.createdAt),
						last_researched_at: iso(detail.contact.lastResearchedAt),
					},
					company: detail.company ? { id: detail.company.id, name: detail.company.name } : null,
					deals: detail.deals.map((deal) => ({
						id: deal.id,
						name: deal.name,
						stage: deal.stage,
						status: deal.status,
					})),
					activities: detail.activities.map((activity) => ({
						id: activity.id,
						kind: activity.kind,
						title: activity.title,
						body: activity.body,
						due_at: iso(activity.dueAt),
						completed_at: iso(activity.completedAt),
						created_at: iso(activity.createdAt),
					})),
					facts: detail.facts.map((fact) => ({
						field: fact.field,
						value: fact.value,
						status: fact.status,
						source: fact.source,
					})),
				};
			},
		}),

		read_company: tool({
			description:
				"读取一家公司的全貌：字段、地址、已有的公司字段事实、全部联系人及 id、相关商机及 id。",
			inputSchema: z.object({ company_id: z.string().trim().min(1) }),
			execute: async ({ company_id }) => {
				const detail = await companyDetail(company_id);
				if (!detail) return { found: false, reason: "没有这家公司。" };

				return {
					found: true,
					company: {
						id: detail.company.id,
						name: detail.company.name,
						domain: detail.company.domain,
						industry: detail.company.industry,
						address: detail.company.address,
						description: detail.company.description,
						created_at: iso(detail.company.createdAt),
					},
					facts: detail.facts.map((fact) => ({
						field: fact.field,
						value: fact.value,
						status: fact.status,
						source: fact.source,
					})),
					contacts: detail.contacts.map((person) => ({
						id: person.id,
						name: `${person.firstName}${person.lastName ?? ""}`,
						title: person.title,
						email: person.email,
						wechat_id: person.wechatId,
					})),
					deals: detail.deals.map((deal) => ({
						id: deal.id,
						name: deal.name,
						stage: deal.stage,
						status: deal.status,
						expected_close_date: deal.expectedCloseDate,
					})),
				};
			},
		}),

		read_deal: tool({
			description: "读取一条商机：阶段、状态、相关公司与联系人 id、阶段变更历史。",
			inputSchema: z.object({ deal_id: z.string().trim().min(1) }),
			execute: async ({ deal_id }) => {
				const detail = await dealDetail(deal_id);
				if (!detail) return { found: false, reason: "没有这条商机。" };

				return {
					found: true,
					deal: {
						id: detail.deal.id,
						name: detail.deal.name,
						stage: detail.deal.stage,
						status: detail.deal.status,
						expected_close_date: detail.deal.expectedCloseDate,
						stage_changed_at: iso(detail.deal.stageChangedAt),
					},
					company: detail.company ? { id: detail.company.id, name: detail.company.name } : null,
					contact: detail.contact
						? {
								id: detail.contact.id,
								name: `${detail.contact.firstName}${detail.contact.lastName ?? ""}`,
							}
						: null,
					stage_history: detail.activities
						.filter((activity) => activity.kind === "stage_change")
						.map((activity) => ({ title: activity.title, at: iso(activity.createdAt) })),
				};
			},
		}),

		search_crm: tool({
			description:
				"按子串查联系人、公司、商机。只做子串精确匹配，不做模糊或拼音近似。返回命中项的 id，可直接交给 read_* 工具。",
			inputSchema: z.object({ text: z.string().trim().min(1).max(CONFIG.lists.maxSearchLength) }),
			execute: async ({ text }) => {
				const hits = await searchCrm(text, CONFIG.lists.pageSize);

				return { query: text, count: hits.length, hits };
			},
		}),

		record_fact: tool({
			description: [
				"给联系人字段写值的唯一通道。三条铁律由服务端强制：",
				"1) 永不覆盖人工录入的值——字段已有值时只会存成建议，等人在界面上确认；",
				"2) 被拒绝过的同值不再提；",
				"3) 没有一手来源不写——evidence 必须含来源类型与库内原文摘录。",
				"field 用字段表里的键或名字（电话/手机/联系电话/phone 都指同一个字段）。字段表里没有的字段，先调 propose_field。",
			].join(""),
			inputSchema: z.object({
				contact_id: z.string().trim().min(1),
				field: z.string().trim().min(1).max(64),
				value: z.string().trim().min(1).max(CONFIG.text.maxFieldLength),
				evidence: z.array(evidenceSchema).min(1),
				source: z.string().trim().max(16).default("agent"),
			}),
			execute: async (input) => {
				const result = await recordFact({
					contactId: input.contact_id,
					field: input.field,
					value: input.value,
					evidence: input.evidence.map((item) => ({
						kind: item.kind,
						quote: item.quote,
						ref: item.ref ?? null,
					})),
					source: input.source,
				});

				return result;
			},
		}),

		record_company_fact: tool({
			description: [
				"给公司字段写值的唯一通道。三条铁律与联系人通道完全相同：",
				"1) 永不覆盖人工录入的值——字段已有值时只存成建议；",
				"2) 被拒绝过的同值不再提；",
				"3) 没有一手来源不写——evidence 必须含来源类型与库内原文摘录。",
				"field 用字段表里的键或名字（行业/所属行业/industry 都指同一个字段）。字段表里没有的字段，先调 propose_field。",
			].join(""),
			inputSchema: z.object({
				company_id: z.string().trim().min(1),
				field: z.string().trim().min(1).max(64),
				value: z.string().trim().min(1).max(CONFIG.text.maxNoteLength),
				evidence: z.array(evidenceSchema).min(1),
				source: z.string().trim().max(16).default("agent"),
			}),
			execute: async (input) => {
				return recordCompanyFact({
					companyId: input.company_id,
					field: input.field,
					value: input.value,
					evidence: input.evidence.map((item) => ({
						kind: item.kind,
						quote: item.quote,
						ref: item.ref ?? null,
					})),
					source: input.source,
				});
			},
		}),

		ensure_company: tool({
			description:
				"按公司全名查一家公司；库里没有就建一条只有名称的空壳，返回它的 id。名称必须逐字来自库内原文，并在 evidence 里给出摘录。它不会修改已存在的公司。",
			inputSchema: z.object({
				name: z.string().trim().min(1).max(CONFIG.text.maxNameLength),
				evidence: z.array(evidenceSchema).min(1),
			}),
			execute: async (input) => {
				const result = await ensureCompany(input.name);

				return {
					...result,
					name: input.name,
					note: result.created
						? "新建了空壳公司，行业与主营介绍还需要 record_company_fact 补。"
						: "公司已存在，未做任何改动。",
				};
			},
		}),

		ensure_contact: tool({
			description: [
				"按线索查一位联系人；库里没有就建一条只有姓名的新记录，返回它的 id。",
				"去重顺序固定为「微信号 → 电话 → 姓名」，命中任意一项即返回既有记录，不会重复建，也不会改写既有记录。",
				"name 是聊天里出现的称呼。微信昵称不等于真实姓名，昵称请放 wechat_id。",
				"建了之后其他字段（职位/邮箱/角色等）还要用 record_fact、classify_role 单独写。",
			].join(""),
			inputSchema: z.object({
				name: z.string().trim().min(1).max(CONFIG.text.maxNameLength),
				wechat_id: z
					.string()
					.trim()
					.max(CONFIG.text.maxFieldLength)
					.nullish()
					.describe("微信昵称或微信号，作为首选查重键"),
				phone: z.string().trim().max(64).nullish(),
				evidence: z.array(evidenceSchema).min(1),
			}),
			execute: async (input) => {
				const result = await ensureContact({
					name: input.name,
					wechatId: input.wechat_id ?? null,
					phone: input.phone ?? null,
				});

				return {
					id: result.id,
					created: result.created,
					matched_by: result.matchedBy,
					name: result.name,
					note: result.created
						? "新建了联系人，其他字段用 record_fact / classify_role 继续补。"
						: `库里已有这个人（命中依据：${result.matchedBy}），未做任何改动。`,
				};
			},
		}),

		link_contact_company: tool({
			description: [
				"把一位联系人挂到一家公司名下。",
				"只在联系人当前没有公司时才写；已有公司时返回 linked=false，不会改挂，需人工确认。",
				"聊天里同时出现这个人和他所属公司时，先 ensure_contact 拿到人、ensure_company 拿到公司，再用这个工具把两者连起来。",
			].join(""),
			inputSchema: z.object({
				contact_id: z.string().trim().min(1).max(36),
				company_id: z.string().trim().min(1).max(36),
			}),
			execute: async (input) => {
				const result = await linkContactCompany({
					contactId: input.contact_id,
					companyId: input.company_id,
				});

				return {
					linked: result.linked,
					reason: result.reason,
					previous_company_id: result.previousCompanyId,
				};
			},
		}),

		classify_role: tool({
			description: [
				"判断一段资料描述的主体属于哪个角色标签，再由系统写入。资料里出现「源头厂家」「供货方」「采购方」「负责对接」「说了算」「管技术」这类描述时就调用它。",
				"联系人用 scope=contact（字段：业务角色），公司用 scope=company（字段：合作角色）。",
				"分类由代码里的分类器完成：命中现有标签就直接写；资料写出了一个新角色就新增标签并写入；资料没有提到角色就什么都不写。",
				"你自己不要挑标签，也不要把角色写进别的字段。text 传资料原文（可以是你摘出来的一段），evidence 给出来源类型与该段原文摘录。",
			].join(""),
			inputSchema: z.object({
				scope: z.enum(FIELD_SCOPES),
				subject_id: z.string().trim().min(1).max(36),
				text: z.string().trim().min(1).max(CONFIG.text.maxNoteLength),
				evidence: z.array(evidenceSchema).min(1),
			}),
			execute: async (input) => {
				const roleField = input.scope === "company" ? "cooperation_role" : "business_role";
				const def = await findFieldDef({ scope: input.scope, term: roleField });

				if (!def || def.status !== "active") {
					return { written: false, reason: "角色字段不在字段表里。" };
				}

				const decision = await roleClassifier().classify({
					scope: input.scope,
					label: def.label,
					text: input.text,
					options: def.options,
				});

				if (decision.kind === "unavailable") {
					return { written: false, outcome: "unavailable", reason: decision.reason };
				}

				if (decision.kind === "other") {
					return { written: false, outcome: "other", reason: decision.reason };
				}

				if (decision.kind === "new") {
					await addFieldOption({ scope: input.scope, key: def.key, value: decision.value });
				}

				const evidence = input.evidence.map((item) => ({
					kind: item.kind,
					quote: item.quote,
					ref: item.ref ?? null,
				}));

				if (input.scope === "company") {
					const result = await recordCompanyFact({
						companyId: input.subject_id,
						field: def.key,
						value: decision.value,
						evidence,
						source: "agent",
					});

					return { ...result, outcome: decision.kind, note: decision.reason };
				}

				const result = await recordFact({
					contactId: input.subject_id,
					field: def.key,
					value: decision.value,
					evidence,
					source: "agent",
				});

				return { ...result, outcome: decision.kind, note: decision.reason };
			},
		}),

		propose_field: tool({
			description: [
				"资料里出现库里没有的字段时，用这个工具提一个新字段建议，等人确认后才生效。",
				"提交前系统会做归一化与别名比对：撞到已有字段就回「已有字段」，不会重复建（电话、联系电话、phone、telephone 是同一个字段）。",
				"如果撞到的字段属于另一个作用域（例如联系人资料里的行业其实是公司字段），返回值会告诉你该写进哪个作用域的哪个字段。",
				"label 写简短的中文字段名，用资料里出现的那个说法，例如「所在城市」「合作起始日」。sample_value 填资料里出现的那个值。不要因为库里没有某类字段就照某个行业的套路补一套。",
			].join(""),
			inputSchema: z.object({
				scope: z.enum(FIELD_SCOPES),
				subject_id: z
					.string()
					.trim()
					.min(1)
					.max(36)
					.describe("这条资料属于哪条记录：联系人 id 或公司 id"),
				label: z.string().trim().min(1).max(24),
				sample_value: z.string().trim().max(CONFIG.text.maxNoteLength).nullish(),
				evidence: z.array(evidenceSchema).min(1),
			}),
			execute: async (input) => {
				const result = await proposeField({
					scope: input.scope,
					label: input.label,
					sampleValue: input.sample_value ?? null,
					sampleRef: input.subject_id,
					evidence: input.evidence.map((item) => ({
						kind: item.kind,
						quote: item.quote,
						ref: item.ref ?? null,
					})),
				});

				if (result.outcome === "exists") {
					return {
						outcome: "exists",
						scope: result.def.scope,
						field: result.def.key,
						label: result.def.label,
						same_scope: result.sameScope,
						note: result.sameScope
							? `已有字段「${result.def.label}」（${result.def.key}），直接写进它，不要新建。`
							: `这是「${result.def.scope === "company" ? "公司" : "联系人"}」的字段「${result.def.label}」，不要挂在当前作用域上。`,
					};
				}

				if (result.outcome === "dismissed_before") {
					return {
						outcome: "dismissed_before",
						label: result.def.label,
						note: "这个字段名被拒绝过，不要再提。",
					};
				}

				return {
					outcome: "proposed",
					scope: result.def.scope,
					field: result.def.key,
					label: result.def.label,
					note: "已提交新字段建议，等人在界面上确认后再生效。",
				};
			},
		}),

		create_activity: tool({
			description:
				"记一条备注或任务。kind=task 且带 due_at 的任务，逾期后会出现在首页「已逾期任务」。",
			inputSchema: z.object({
				kind: z.enum(ACTIVITY_KINDS).default("note"),
				title: z.string().trim().min(1).max(CONFIG.text.maxNameLength),
				body: z.string().trim().max(CONFIG.text.maxNoteLength).nullish(),
				contact_id: z.string().trim().min(1).nullish(),
				company_id: z.string().trim().min(1).nullish(),
				deal_id: z.string().trim().min(1).nullish(),
				due_at: z.string().trim().min(1).nullish().describe("ISO 8601 时间，例如 2026-10-20T09:00:00+08:00"),
			}),
			execute: async (input) => {
				const dueAt = input.due_at ? Date.parse(input.due_at) : null;

				if (input.due_at && Number.isNaN(dueAt)) {
					return { created: false, reason: "due_at 不是合法的 ISO 时间。" };
				}

				const activity = await createActivity({
					kind: input.kind,
					title: input.title,
					body: input.body ?? null,
					contactId: input.contact_id ?? null,
					companyId: input.company_id ?? null,
					dealId: input.deal_id ?? null,
					dueAt,
				});

				return {
					created: true,
					activity: {
						id: activity.id,
						kind: activity.kind,
						title: activity.title,
						due_at: iso(activity.dueAt),
					},
				};
			},
		}),

		schedule_recheck: tool({
			description:
				"安排「N 天后再看一次这位联系人」。到期后系统自动把他重新排进研究队列。reason 会展示给人看，写清为什么。",
			inputSchema: z.object({
				contact_id: z.string().trim().min(1),
				days: z
					.number()
					.int()
					.min(CONFIG.research.minRecheckDays)
					.max(CONFIG.research.maxRecheckDays),
				reason: z.string().trim().min(1).max(CONFIG.text.maxNoteLength),
			}),
			execute: async ({ contact_id, days, reason }) => {
				const taskId = await scheduleRecheck({ contactId: contact_id, days, reason });

				return {
					scheduled: true,
					task_id: taskId,
					run_at: iso(Date.now() + days * CONFIG.time.dayMs),
				};
			},
		}),
	};
}
