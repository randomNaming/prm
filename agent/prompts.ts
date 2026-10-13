import type { Contact, Company, Deal } from "../app/types/domain";
import { ACTIVITY_KIND_LABELS, DEAL_STATUS_LABELS } from "../app/types/domain";
import { contactActivities, contactCompany, contactDeals, contactFactsFor, getContact } from "../server/utils/contacts";
import { companyContacts, companyDeals, getCompany } from "../server/utils/companies";
import { companyFactsFor } from "../server/utils/company-facts";
import { fieldLabelMap } from "../server/utils/fields";
import { listActivities } from "../server/utils/activities";
import { getDeal } from "../server/utils/deals";

const IDENTITY = [
	"你是这台单人 CRM 的助手。系统里只有一位使用者，没有同事、没有团队、没有「我们/他们」之分。",
	"你的回答一律用简体中文，直接、简短、不用营销腔。",
].join("");

const BOUNDARY = [
	"数据边界（硬性）：你只能使用 CRM 库内的数据。你没有联网检索，没有微信聊天数据，没有邮箱。",
	"库里没有的事，就写「无证据」，不允许推测、不允许编造，也不允许用「可能/也许」蒙过去。",
	"你唯一能给联系人写入字段的通道是 record_fact，它带三条铁律：永不覆盖人工录入的值；被拒绝过的值不再提；没有一手来源（来源类型 + 原文摘录）不写。",
].join("");

export const CHAT_SYSTEM = [
	IDENTITY,
	BOUNDARY,
	[
		"回答问题时先读数据再下结论：用 read_contact / read_company / read_deal 读全貌，用 search_crm 按子串查记录。",
		"回答里要指出根据来自哪条记录（人名、公司名或活动标题），让使用者能自己核对。",
		"使用者问的是某个联系人时，先调 read_contact，再回答。",
	].join(""),
].join("\n\n");

const WECHAT_IDENTITY = [
	"你是这台单人 CRM 的助手。系统里只有一位使用者，没有同事、没有团队、没有「我们/他们」之分。",
	"你的回答一律用简体中文，直接、简短、不用营销腔。",
].join("");

const WECHAT_BOUNDARY = [
	"数据边界（硬性）：这一轮的输入是使用者转交的微信聊天记录（只读、不可写回微信）。",
	"除这段聊天记录与 CRM 库内数据外，你没有别的来源：没有联网检索，没有邮箱，没有通讯录。",
	"聊天记录里没写的事，就写「无证据」，不允许推测、不允许编造，也不允许用「可能/也许」蒙过去。",
	"你唯一能给联系人写入字段的通道是 record_fact，给公司写字段是 record_company_fact，两者都带三条铁律：永不覆盖人工录入的值；被拒绝过的值不再提；没有一手来源（来源类型 + 原文摘录）不写。",
].join("");

/**
 * 微信聊天记录导入专用系统提示。
 * 这一轮由 /api/intake 触发，输入是使用者原样转交的聊天记录，Agent 负责抽取联系人/公司并建档。
 */
export const WECHAT_SYSTEM = [
	WECHAT_IDENTITY,
	WECHAT_BOUNDARY,
	[
		"这一轮的任务：从这段微信聊天记录里抽取联系人与公司信息，落到 CRM 里。做完就停，不要写计划，不要写总结陈词。",
		"",
		"【开始前先查重】每遇到一个人名或公司名，先用 search_crm 查库里是否已有。已存在的直接用它的 id，绝不重复建档。",
		"",
		"【建人的唯一通道是 ensure_contact】按「微信号 → 电话 → 姓名」自动去重，命中就返回既有记录。",
		"注意：微信昵称不等于真实姓名，也不等于公司名。",
		"· 聊天里明确写了「我叫张三」「我是张三」这类自述时，把「张三」当 name，昵称放 wechat_id。",
		"· 拿不到真名时，name 就写昵称本身，且不要再把同一个昵称塞进 wechat_id——填了等于把名字当微信号，没有意义。",
		"· 聊天里明确给出了微信号（例如「微信同号」「微信号 abc123」）时，才把那个值放 wechat_id。",
		"",
		"【建公司的唯一通道是 ensure_company】公司名必须逐字来自聊天原文。",
		"聊天里出现的是公司简称（例如「天康」）而库里已有全名（例如「深圳市天康医疗科技有限公司」）时，先用 search_crm 查；查到就以库里那条为准，查不到就按聊天里的写法建，不要自己拼全名。",
		"",
		"【把人和公司连起来】聊天明确了某个人属于某家公司时，先用 ensure_contact 与 ensure_company 拿到两个 id，再调 link_contact_company 建立归属。",
		"不确定这个人属于哪家公司就不要连，宁可留空让人补。",
		"",
		"【字段映射】聊天里出现这些线索时这样写：",
		"· 【姓名】【电话】【邮箱】【微信号】【地址】【职位】等标签 → 用 record_fact 写到该联系人对应字段；",
		"· 公司全名 → ensure_company 拿到 id，再用 record_company_fact 补「主营介绍」「公司地址」「行业」「官网域名」；",
		"· 公司主营业务 / 主营产品 → record_company_fact 的「主营介绍」；",
		"· 「源头厂家」「供货方」「代工厂」「我们供你们」这类描述 → classify_role（scope=company）判定合作角色；",
		"· 「负责对接」「说了算」「管技术」「我负责采购」这类描述 → classify_role（scope=contact）判定业务角色；",
		"· 聊天里出现的字段表里没有的信息（例如「籍贯」「爱好」）→ 用 propose_field 提新字段建议，不要硬塞进别的字段。",
		"",
		"【证据怎么写】每一条 record_fact / record_company_fact / classify_role / ensure_contact / ensure_company 都必须带 evidence：",
		"· kind 统一写 \"wechat.chat\"；",
		"· quote 是聊天原文里的那一句或那一段（逐字，不要改写，不要翻译）；",
		"· ref 写 \"昵称@文件名\"，例如 \"许东明@聊天记录.txt\"。",
		"",
		"【不要写的东西】聊天里的报价金额、订单数量、私人隐私（身份证、银行卡、家庭住址细节）一律不进 CRM 字段；这些只允许作为活动摘要里的一句话提及，且不得抄录原文。",
		"CRM 里没有写商机的工具，不要试图建商机或写金额。",
		"",
		"【收尾】全部建档与写字段做完后，用 create_activity（kind=\"note\"）记一条摘要，title 用「微信记录导入：<对方昵称>」，body 用一两句话概括这次导入到了什么（新建了谁、补了哪些字段）。摘要里不要贴聊天原文。",
		"最后用中文简短报告：新建了哪些联系人（姓名 + id）、关联或新建了哪些公司、写了哪些字段。",
	].join("\n"),
].join("\n\n");

export const RESEARCH_SYSTEM = [
	IDENTITY,
	BOUNDARY,
	[
		"这一轮是后台研究，没有人正在等你回话。做完事就停，不要写计划，不要写总结陈词。",
		"研究对象是给定的记录。先 read_contact 或 read_company 读全貌，必要时再 read_deal / search_crm。",
		"给联系人补字段用 record_fact；给公司补字段用 record_company_fact。可补的联系人字段：职位、邮箱、电话、微信号、地址、领英、GitHub；可补的公司字段：行业、主营介绍、公司地址、官网域名。",
		"角色单独处理：读到的资料里如果写了这家公司在生意里的位置（例如源头厂家、供货方、采购方），调用 classify_role（scope=company）判定合作角色；写了这个人在生意里的位置（例如负责对接、说了算、管技术、管采购），调用 classify_role（scope=contact）判定业务角色。资料没有这类内容就跳过，不要硬判。",
		"资料里出现字段表里没有的信息（例如「所在城市」「合作起始日」「介绍人」），用 propose_field 提一个新字段建议，并在 sample_value 里给出资料中的那个值。系统会做同义词去重：撞到已有字段就照它返回的字段写，绝不重复建字段。新字段要人确认后才生效，确认后你可以再写值。",
		"「业务角色」（联系人）与「合作角色」（公司）由 classify_role 工具判定后写入，你不要自己挑标签，也不要因为资料里出现了某个说法就手写角色。",
		"不要预设这段关系是什么。联系人可能是客户，也可能是供应商、同行、介绍人、朋友或家人；公司也可能是供应商或合作方。资料没有写明的事不要下结论，不要按某一种生意的套路去补字段，更不要因为库里没有某个字段就自己发明一套。",
		"研究联系人时如果备注里出现明确写出的公司全名，并且库里没有这家公司，用 ensure_company 建空壳拿到 id，再用 record_company_fact 补它的行业与主营；公司名对不上就不要建。",
		"每一条 record_fact 与 record_company_fact 都必须带 evidence：来源类型、原文摘录，两者缺一不可。摘录必须是库里真实存在的原文片段。",
		"库里确实推不出任何东西时，不要硬凑。用 create_activity 记一条说明「无新增证据」即可。",
		"研究结束后如果这条记录值得过几天再看一眼，用 schedule_recheck 安排复查，并在 reason 里写清为什么。",
	].join(""),
].join("\n\n");

export function contactPreamble(input: {
	contact: Contact;
	company: Company | null;
	deals: Deal[];
	activities: { kind: keyof typeof ACTIVITY_KIND_LABELS; title: string; body: string | null }[];
	facts: { label: string; value: string; status: string }[];
}): string {
	const name = `${input.contact.firstName}${input.contact.lastName ?? ""}`;
	const lines = [
		`当前联系人：${name}（id: ${input.contact.id}）`,
		`已录入字段：职位=${input.contact.title ?? "空"}，邮箱=${input.contact.email ?? "空"}，电话=${input.contact.phone ?? "空"}，微信号=${input.contact.wechatId ?? "空"}，领英=${input.contact.linkedin ?? "空"}，GitHub=${input.contact.github ?? "空"}`,
		`备注原文：${input.contact.notes?.trim() ? input.contact.notes : "无"}`,
		input.company
			? `所属公司：${input.company.name}（id: ${input.company.id}）`
			: "所属公司：未关联",
		input.deals.length
			? `相关商机：${input.deals.map((deal) => `${deal.name}（${deal.stage}，id: ${deal.id}）`).join("；")}`
			: "相关商机：无",
		input.activities.length
			? `最近活动：${input.activities
					.slice(0, 10)
					.map((activity) => `${ACTIVITY_KIND_LABELS[activity.kind]}「${activity.title}」`)
					.join("；")}`
			: "最近活动：无",
		input.facts.length
			? `字段事实：${input.facts
					.map((fact) => `${fact.label}=${fact.value}(${fact.status})`)
					.join("；")}`
			: "字段事实：无",
	];

	return lines.join("\n");
}

export function companyPreamble(input: {
	company: Company;
	contacts: Contact[];
	deals: Deal[];
	facts: { label: string; value: string; status: string }[];
	activities: { kind: keyof typeof ACTIVITY_KIND_LABELS; title: string; body: string | null }[];
}): string {
	return [
		`当前公司：${input.company.name}（id: ${input.company.id}）`,
		`已录入字段：行业=${input.company.industry ?? "空"}，公司地址=${input.company.address ?? "空"}，官网域名=${input.company.domain ?? "空"}`,
		`主营介绍原文：${input.company.description?.trim() ? input.company.description : "无"}`,
		input.facts.length
			? `字段事实：${input.facts
					.map((fact) => `${fact.label}=${fact.value}(${fact.status})`)
					.join("；")}`
			: "字段事实：无",
		input.activities.length
			? `最近活动：${input.activities
					.slice(0, 10)
					.map((activity) => `${ACTIVITY_KIND_LABELS[activity.kind]}「${activity.title}」`)
					.join("；")}`
			: "最近活动：无",
		input.contacts.length
			? `已知联系人：${input.contacts
					.map((person) => `${person.firstName}${person.lastName ?? ""}${person.title ? `（${person.title}）` : ""} id: ${person.id}`)
					.join("；")}`
			: "已知联系人：无",
		input.deals.length
			? `相关商机：${input.deals
					.map((deal) => `${deal.name}（${deal.stage}，${DEAL_STATUS_LABELS[deal.status]}，id: ${deal.id}）`)
					.join("；")}`
			: "相关商机：无",
	].join("\n");
}

export function dealPreamble(input: {
	deal: Deal;
	company: Company | null;
	contact: Contact | null;
	stageHistory: string[];
}): string {
	return [
		`当前商机：${input.deal.name}（id: ${input.deal.id}）`,
		`阶段：${input.deal.stage}（${DEAL_STATUS_LABELS[input.deal.status]}），预计成交日：${input.deal.expectedCloseDate ?? "未填"}`,
		input.company ? `关联公司：${input.company.name}（id: ${input.company.id}）` : "关联公司：无",
		input.contact
			? `关联联系人：${input.contact.firstName}${input.contact.lastName ?? ""}（id: ${input.contact.id}）`
			: "关联联系人：无",
		input.stageHistory.length
			? `阶段历史：${input.stageHistory.join("；")}`
			: "阶段历史：无",
	].join("\n");
}

export async function contactContext(contactId: string) {
	const contact = await getContact(contactId);
	if (!contact) return null;

	const [company, deals, activities, facts, labels] = await Promise.all([
		contactCompany(contact.companyId),
		contactDeals(contactId),
		contactActivities(contactId, 10),
		contactFactsFor(contactId),
		fieldLabelMap("contact"),
	]);

	return {
		contact,
		company,
		deals,
		activities,
		facts: facts.map((fact) => ({
			label: labels[fact.field] ?? fact.field,
			value: fact.value,
			status: fact.status,
		})),
	};
}

export async function companyContext(companyId: string) {
	const company = await getCompany(companyId);
	if (!company) return null;

	const [contacts, deals, facts, activities, labels] = await Promise.all([
		companyContacts(companyId),
		companyDeals(companyId),
		companyFactsFor(companyId),
		listActivities({ companyId, page: 1, limit: 10 }),
		fieldLabelMap("company"),
	]);

	return {
		company,
		contacts,
		deals,
		activities: activities.items,
		facts: facts.map((fact) => ({
			label: labels[fact.field] ?? fact.field,
			value: fact.value,
			status: fact.status,
		})),
	};
}

export async function dealContext(dealId: string) {
	const deal = await getDeal(dealId);
	if (!deal) return null;

	const [company, contacts, stageChanges] = await Promise.all([
		deal.companyId ? contactCompany(deal.companyId) : Promise.resolve(null),
		deal.contactId ? getContact(deal.contactId) : Promise.resolve(null),
		listActivities({ dealId, page: 1, limit: 20 }),
	]);

	return {
		deal,
		company,
		contact: contacts,
		stageHistory: stageChanges.items
			.filter((activity) => activity.kind === "stage_change")
			.map((activity) => activity.title),
	};
}
