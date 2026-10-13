import type {
	Activity,
	ChatMessage,
	Company,
	Contact,
	ContactDetail,
	CompanyDetail,
	Conversation,
	Dashboard,
	Deal,
	DealDetail,
	FieldDef,
	Page,
	SearchHit,
	QueueStatus,
} from "~/types/domain";

export type ListQuery = {
	q?: string;
	page?: number;
	pageSize?: number;
	archived?: boolean;
};

export function useApi() {
	return {
		dashboard: () => $fetch<Dashboard>("/api/dashboard"),

		listContacts: (query: ListQuery = {}) =>
			$fetch<Page<Contact>>("/api/contacts", { query }),
		contactDetail: (id: string) => $fetch<ContactDetail>(`/api/contacts/${id}`),
		createContact: (body: Record<string, unknown>) =>
			$fetch<{ contact: Contact }>("/api/contacts", { method: "POST", body }),
		updateContact: (id: string, body: Record<string, unknown>) =>
			$fetch<{ contact: Contact }>(`/api/contacts/${id}`, { method: "PUT", body }),
		archiveContact: (id: string) =>
			$fetch<{ archived: boolean }>(`/api/contacts/${id}`, { method: "DELETE" }),

		listCompanies: (query: ListQuery = {}) =>
			$fetch<Page<Company>>("/api/companies", { query }),
		companyDetail: (id: string) => $fetch<CompanyDetail>(`/api/companies/${id}`),
		createCompany: (body: Record<string, unknown>) =>
			$fetch<{ company: Company }>("/api/companies", { method: "POST", body }),
		updateCompany: (id: string, body: Record<string, unknown>) =>
			$fetch<{ company: Company }>(`/api/companies/${id}`, { method: "PUT", body }),
		archiveCompany: (id: string) =>
			$fetch<{ archived: boolean }>(`/api/companies/${id}`, { method: "DELETE" }),
		companyOptions: (q = "") =>
			$fetch<{ items: Company[] }>("/api/company-options", { query: { q } }),

		listDeals: (query: ListQuery & { stage?: string } = {}) =>
			$fetch<Page<Deal>>("/api/deals", { query }),
		dealDetail: (id: string) => $fetch<DealDetail>(`/api/deals/${id}`),
		createDeal: (body: Record<string, unknown>) =>
			$fetch<{ deal: Deal }>("/api/deals", { method: "POST", body }),
		updateDeal: (id: string, body: Record<string, unknown>) =>
			$fetch<{ deal: Deal }>(`/api/deals/${id}`, {
				method: "POST",
				body: { action: "edit", deal: body },
			}),
		changeDealStage: (id: string, stage: string) =>
			$fetch<{ deal: Deal }>(`/api/deals/${id}`, {
				method: "POST",
				body: { action: "stage", stage },
			}),
		archiveDeal: (id: string) =>
			$fetch<{ archived: boolean }>(`/api/deals/${id}`, {
				method: "POST",
				body: { action: "archive" },
			}),

		listActivities: (query: { contactId?: string; companyId?: string; dealId?: string } = {}) =>
			$fetch<Page<Activity>>("/api/activities", { query }),
		createActivity: (body: Record<string, unknown>) =>
			$fetch<{ activity: Activity }>("/api/activities", { method: "POST", body }),
		decideActivity: (id: string, action: "complete" | "reopen") =>
			$fetch<{ ok: boolean }>("/api/activity-decision", { method: "POST", body: { id, action } }),

		search: (q: string) => $fetch<{ query: string; hits: SearchHit[] }>("/api/search", { query: { q } }),

		decideFact: (id: string, action: "accept" | "reject", subject: "contact" | "company" = "contact") =>
			$fetch<{ ok: boolean; reason: string }>("/api/fact-decision", {
				method: "POST",
				body: { id, action, subject },
			}),

		conversations: (query: { contactId?: string; companyId?: string; dealId?: string } = {}) =>
			$fetch<{ conversations: Conversation[] }>("/api/conversations", { query }),
		messages: (conversationId: string) =>
			$fetch<{ messages: ChatMessage[] }>("/api/conversations", { query: { conversationId } }),

		status: () => $fetch<QueueStatus>("/api/status"),

		fields: (scope: "contact" | "company") =>
			$fetch<{ fields: FieldDef[] }>("/api/fields", { query: { scope } }),
		decideField: (id: string, action: "accept" | "reject") =>
			$fetch<{ ok: boolean; reason: string }>("/api/field-decision", {
				method: "POST",
				body: { id, action },
			}),

		research: (subject: "contact" | "company", id: string) =>
			$fetch<{ queued: boolean; taskId: string }>("/api/research", {
				method: "POST",
				body: { subject, id },
			}),
	};
}
