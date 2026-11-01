import type {
	Activity,
	Board,
	ChatMessage,
	Company,
	CompanyListItem,
	Contact,
	ContactDetail,
	ContactListItem,
	CompanyDetail,
	Conversation,
	Dashboard,
	Deal,
	DealDetail,
	FieldDef,
	McpOverview,
	Page,
	PublicHolidayResult,
	SearchHit,
	QueueStatus,
} from "~/types/domain";

export type ListQuery = {
	q?: string;
	page?: number;
	pageSize?: number;
	archived?: boolean;
	/** 按关系维护筛选；RELATIONSHIP_BLANK 表示「留空」那一档。 */
	relationship?: string;
};

type FetchOptions = NonNullable<Parameters<typeof $fetch>[1]>;

export function useApi() {
	// SSR 时浏览器 Cookie 不会自动带给同进程的内部 /api 请求，必须显式转发，
	// 否则登录后服务端取数仍然 401、页面直接空白。
	const forwarded = import.meta.server ? useRequestHeaders(["cookie"]) : undefined;

	const request = <T>(path: string, options: Record<string, unknown> = {}) =>
		$fetch<T>(path, {
			...options,
			headers: {
				...((options.headers as Record<string, string> | undefined) ?? {}),
				...forwarded,
			},
		} as FetchOptions);

	return {
		dashboard: () => request<Dashboard>("/api/dashboard"),

		board: () => request<Board>("/api/board"),
		pinBoardItem: (body: {
			type: string;
			id: string;
			quadrant: string;
			inferred: string;
		}) =>
			request<{ ok: boolean; reason: string; pinned: boolean }>("/api/board/pin", {
				method: "POST",
				body,
			}),

		listContacts: (query: ListQuery = {}) =>
			request<Page<ContactListItem>>("/api/contacts", { query }),
		contactDetail: (id: string) => request<ContactDetail>(`/api/contacts/${id}`),
		createContact: (body: Record<string, unknown>) =>
			request<{ contact: Contact }>("/api/contacts", { method: "POST", body }),
		updateContact: (id: string, body: Record<string, unknown>) =>
			request<{ contact: Contact }>(`/api/contacts/${id}`, { method: "PUT", body }),
		archiveContact: (id: string) =>
			request<{ archived: boolean }>(`/api/contacts/${id}`, { method: "DELETE" }),
		restoreContact: (id: string) =>
			request<{ restored: boolean }>(`/api/contacts/${id}/restore`, { method: "POST" }),

		listCompanies: (query: ListQuery = {}) =>
			request<Page<CompanyListItem>>("/api/companies", { query }),
		companyDetail: (id: string) => request<CompanyDetail>(`/api/companies/${id}`),
		createCompany: (body: Record<string, unknown>) =>
			request<{ company: Company }>("/api/companies", { method: "POST", body }),
		updateCompany: (id: string, body: Record<string, unknown>) =>
			request<{ company: Company }>(`/api/companies/${id}`, { method: "PUT", body }),
		archiveCompany: (id: string) =>
			request<{ archived: boolean }>(`/api/companies/${id}`, { method: "DELETE" }),
		restoreCompany: (id: string) =>
			request<{ restored: boolean }>(`/api/companies/${id}/restore`, { method: "POST" }),
		companyOptions: (q = "") =>
			request<{ items: Company[] }>("/api/company-options", { query: { q } }),

		listDeals: (query: ListQuery & { stage?: string } = {}) =>
			request<Page<Deal>>("/api/deals", { query }),
		dealDetail: (id: string) => request<DealDetail>(`/api/deals/${id}`),
		createDeal: (body: Record<string, unknown>) =>
			request<{ deal: Deal }>("/api/deals", { method: "POST", body }),
		updateDeal: (id: string, body: Record<string, unknown>) =>
			request<{ deal: Deal }>(`/api/deals/${id}`, {
				method: "POST",
				body: { action: "edit", deal: body },
			}),
		changeDealStage: (id: string, stage: string) =>
			request<{ deal: Deal }>(`/api/deals/${id}`, {
				method: "POST",
				body: { action: "stage", stage },
			}),
		archiveDeal: (id: string) =>
			request<{ archived: boolean }>(`/api/deals/${id}`, {
				method: "POST",
				body: { action: "archive" },
			}),

		listActivities: (query: { contactId?: string; companyId?: string; dealId?: string } = {}) =>
			request<Page<Activity>>("/api/activities", { query }),
		createActivity: (body: Record<string, unknown>) =>
			request<{ activity: Activity }>("/api/activities", { method: "POST", body }),
		decideActivity: (id: string, action: "complete" | "reopen") =>
			request<{ ok: boolean }>("/api/activity-decision", { method: "POST", body: { id, action } }),

		search: (q: string) => request<{ query: string; hits: SearchHit[] }>("/api/search", { query: { q } }),

		decideFact: (
			id: string,
			action: "accept" | "reject" | "revert",
			subject: "contact" | "company" = "contact",
		) =>
			request<{ ok: boolean; reason: string }>("/api/fact-decision", {
				method: "POST",
				body: { id, action, subject },
			}),

		markArchivesViewed: (contactId: string) =>
			request<{ ok: boolean; marked: number }>("/api/intake-viewed", {
				method: "POST",
				body: { contactId },
			}),

		decidePromise: (id: string, action: "fulfilled" | "cancelled", note?: string) =>
			request<{ ok: boolean; reason: string }>("/api/promise-decision", {
				method: "POST",
				body: { id, action, note },
			}),

		conversations: (query: { contactId?: string; companyId?: string; dealId?: string } = {}) =>
			request<{ conversations: Conversation[] }>("/api/conversations", { query }),
		messages: (conversationId: string) =>
			request<{ messages: ChatMessage[] }>("/api/conversations", { query: { conversationId } }),

		publicHolidays: (country: string, year: number) =>
			request<PublicHolidayResult>("/api/public-holidays", { query: { country, year } }),

		status: () => request<QueueStatus>("/api/status"),

		fields: (scope: "contact" | "company") =>
			request<{ fields: FieldDef[] }>("/api/fields", { query: { scope } }),
		decideField: (id: string, action: "accept" | "reject") =>
			request<{ ok: boolean; reason: string }>("/api/field-decision", {
				method: "POST",
				body: { id, action },
			}),

		research: (subject: "contact" | "company", id: string) =>
			request<{ queued: boolean; taskId: string }>("/api/research", {
				method: "POST",
				body: { subject, id },
			}),
		cancelResearch: (subject: "contact" | "company", id: string) =>
			request<{ ok: boolean; cancelled: number; reason: string }>("/api/research-cancel", {
				method: "POST",
				body: { subject, id },
			}),

		mcp: () => request<McpOverview>("/api/mcp"),
	};
}
