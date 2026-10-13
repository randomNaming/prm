import type { CompanyListItem, ContactListItem } from "~/types/domain";
import { formatDate, formatRelative, personName } from "./format";

/**
 * 列的渲染方式。表格本身不认识字段名，只按 kind 决定怎么画这一格。
 */
export type ListColumnKind = "link" | "company" | "tag" | "relative" | "text" | "count";

export type ListColumn<T> = {
	key: string;
	label: string;
	minWidth: number;
	/** 首次打开（localStorage 里还没有偏好）时是否显示。 */
	defaultVisible: boolean;
	kind: ListColumnKind;
	value: (row: T) => string;
	/** 只有 link / company 用得上：这一格点进去跳哪里。 */
	to?: (row: T) => string;
	/** 来自 field_defs 的字段，在选择器里单独分组。 */
	custom?: boolean;
};

/**
 * field_defs 里已经有独立数据库列的内置字段。
 * 它们不该再作为「自定义字段」重复出现在列表里。
 */
export const CONTACT_BUILTIN_FIELD_KEYS = [
	"title",
	"email",
	"phone",
	"wechat_id",
	"address",
	"business_role",
	"relationship_state",
	"repair_note",
	"linkedin",
	"github",
] as const;

export const COMPANY_BUILTIN_FIELD_KEYS = [
	"industry",
	"description",
	"address",
	"cooperation_role",
	"domain",
] as const;

/**
 * 联系人列表的列。
 *
 * 默认只留「谁 / 什么角色 / 哪家公司 / 什么时候动过」——
 * 职位、邮箱、微信号这类短期用不上的字段仍可勾选，但不再占默认视野。
 */
export const CONTACT_COLUMNS: ListColumn<ContactListItem>[] = [
	{
		key: "name",
		label: "姓名",
		minWidth: 150,
		defaultVisible: true,
		kind: "link",
		value: (row) => personName(row),
		to: (row) => `/contacts/${row.id}`,
	},
	{
		key: "businessRole",
		label: "业务角色",
		minWidth: 110,
		defaultVisible: true,
		kind: "tag",
		value: (row) => row.businessRole ?? "",
	},
	{
		key: "company",
		label: "公司",
		minWidth: 170,
		defaultVisible: true,
		kind: "company",
		value: (row) => row.companyName ?? "",
		to: (row) => (row.companyId ? `/companies/${row.companyId}` : ""),
	},
	{
		key: "updatedAt",
		label: "最近更新",
		minWidth: 120,
		defaultVisible: true,
		kind: "relative",
		value: (row) => formatRelative(row.updatedAt),
	},
	{
		key: "phone",
		label: "电话",
		minWidth: 130,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.phone ?? "",
	},
	{
		key: "wechatId",
		label: "微信号",
		minWidth: 130,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.wechatId ?? "",
	},
	{
		key: "email",
		label: "邮箱",
		minWidth: 180,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.email ?? "",
	},
	{
		key: "title",
		label: "职位",
		minWidth: 140,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.title ?? "",
	},
	{
		key: "address",
		label: "地址",
		minWidth: 180,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.address ?? "",
	},
	{
		key: "linkedin",
		label: "领英",
		minWidth: 160,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.linkedin ?? "",
	},
	{
		key: "github",
		label: "GitHub",
		minWidth: 160,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.github ?? "",
	},
	{
		key: "notes",
		label: "备注",
		minWidth: 200,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.notes ?? "",
	},
	{
		key: "createdAt",
		label: "创建时间",
		minWidth: 120,
		defaultVisible: false,
		kind: "relative",
		value: (row) => formatRelative(row.createdAt),
	},
	{
		key: "lastResearchedAt",
		label: "最近研究",
		minWidth: 130,
		defaultVisible: false,
		kind: "text",
		value: (row) => (row.lastResearchedAt ? formatRelative(row.lastResearchedAt) : "尚未研究"),
	},
	{
		// 没标的人显示「默认」而不是 —：留空是有含义的档位，不是缺数据。
		key: "relationshipState",
		label: "关系维护",
		minWidth: 110,
		defaultVisible: false,
		kind: "tag",
		value: (row) => row.relationshipState ?? "默认",
	},
	{
		key: "repairNote",
		label: "修复说明",
		minWidth: 220,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.repairNote ?? "",
	},
];

/**
 * 公司列表的列。
 *
 * 默认是「哪家 / 什么合作角色 / 做什么行业 / 有几个人对接 / 什么时候动过」，
 * 域名、地址这类细节交给用户自己勾。
 */
export const COMPANY_COLUMNS: ListColumn<CompanyListItem>[] = [
	{
		key: "name",
		label: "公司名",
		minWidth: 200,
		defaultVisible: true,
		kind: "link",
		value: (row) => row.name,
		to: (row) => `/companies/${row.id}`,
	},
	{
		key: "cooperationRole",
		label: "合作角色",
		minWidth: 110,
		defaultVisible: true,
		kind: "tag",
		value: (row) => row.cooperationRole ?? "",
	},
	{
		key: "industry",
		label: "行业",
		minWidth: 140,
		defaultVisible: true,
		kind: "text",
		value: (row) => row.industry ?? "",
	},
	{
		key: "contactCount",
		label: "联系人",
		minWidth: 90,
		defaultVisible: true,
		kind: "count",
		value: (row) => String(row.contactCount),
	},
	{
		key: "updatedAt",
		label: "最近更新",
		minWidth: 120,
		defaultVisible: true,
		kind: "relative",
		value: (row) => formatRelative(row.updatedAt),
	},
	{
		key: "domain",
		label: "官网域名",
		minWidth: 160,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.domain ?? "",
	},
	{
		key: "address",
		label: "公司地址",
		minWidth: 180,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.address ?? "",
	},
	{
		key: "description",
		label: "主营介绍",
		minWidth: 220,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.description ?? "",
	},
	{
		key: "source",
		label: "来源",
		minWidth: 100,
		defaultVisible: false,
		kind: "text",
		value: (row) => row.source ?? "",
	},
	{
		key: "createdAt",
		label: "创建时间",
		minWidth: 120,
		defaultVisible: false,
		kind: "relative",
		value: (row) => formatDate(row.createdAt),
	},
];

/** 把 field_defs 里生效的自定义字段补成可勾选的列。 */
export function customColumns<T extends { facts: Record<string, string> }>(
	fields: { key: string; label: string; scope: string; status: string }[],
	scope: "contact" | "company",
	builtinKeys: readonly string[],
): ListColumn<T>[] {
	const taken = new Set<string>(builtinKeys);

	return fields
		.filter((field) => field.scope === scope && field.status === "active" && !taken.has(field.key))
		.map((field) => ({
			key: field.key,
			label: field.label,
			minWidth: 140,
			defaultVisible: false,
			kind: "text" as const,
			custom: true,
			value: (row: T) => row.facts?.[field.key] ?? "",
		}));
}
