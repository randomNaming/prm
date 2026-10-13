<script setup lang="ts">
import { ACTIVITY_KIND_LABELS, DEAL_STAGES, FACT_FIELDS, FACT_FIELD_LABELS } from "~/types/domain";
import type { IntakeArchive } from "~/types/domain";

const api = useApi();
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));

const { data, refresh } = await useAsyncData(`contact-${id.value}`, () =>
	api.contactDetail(id.value),
);

const { data: fieldDefs, refresh: refreshFields } = await useAsyncData(`contact-fields`, () =>
	api.fields("contact"),
);

const BUILTIN_KEYS = new Set<string>(FACT_FIELDS);

const fieldLabels = computed(() => {
	const labels: Record<string, string> = { ...FACT_FIELD_LABELS };

	for (const field of fieldDefs.value?.fields ?? []) {
		if (field.status === "active") labels[field.key] = field.label;
	}

	return labels;
});

const customFacts = computed(() =>
	(data.value?.facts ?? []).filter(
		(fact) => fact.status === "applied" && !BUILTIN_KEYS.has(fact.field),
	),
);

const activeTab = ref("overview");
const showEdit = ref(false);
const submitting = ref(false);
const errorText = ref("");
const factBusy = ref(false);
const researchBusy = ref(false);
const noteTitle = ref("");
const noteBody = ref("");
const archiveBusy = ref("");
const openedArchive = ref("");
const archiveText = ref("");
const archiveError = ref("");

/**
 * 聊天留底只读：原文存在会话的 user 消息里，按需取回，
 * 不塞进详情接口 —— 一段导出动辄上万字。
 */
async function toggleArchive(item: IntakeArchive) {
	if (openedArchive.value === item.conversationId) {
		openedArchive.value = "";

		return;
	}

	archiveBusy.value = item.conversationId;
	archiveError.value = "";

	try {
		const result = await api.messages(item.conversationId);
		const original = result.messages.find((message) => message.role === "user");

		archiveText.value = original?.content ?? "（这条留底里没有找到原文）";
		openedArchive.value = item.conversationId;
	} catch (error) {
		archiveError.value = error instanceof Error ? error.message : "原文读取失败。";
	} finally {
		archiveBusy.value = "";
	}
}

async function editContact(payload: Record<string, unknown>) {
	submitting.value = true;
	errorText.value = "";

	try {
		await api.updateContact(id.value, payload);
		showEdit.value = false;
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败。";
	} finally {
		submitting.value = false;
	}
}

async function archive() {
	await api.archiveContact(id.value);
	await router.push("/contacts");
}

async function research() {
	researchBusy.value = true;

	try {
		await api.research("contact", id.value);
		await refresh();
	} finally {
		researchBusy.value = false;
	}
}

async function decideFact(payload: { id: string; action: "accept" | "reject" }) {
	factBusy.value = true;

	try {
		await api.decideFact(payload.id, payload.action);
		await refresh();
	} finally {
		factBusy.value = false;
	}
}

async function decideField(payload: { id: string; action: "accept" | "reject" }) {
	factBusy.value = true;

	try {
		await api.decideField(payload.id, payload.action);
		await Promise.all([refresh(), refreshFields()]);
	} finally {
		factBusy.value = false;
	}
}

async function addNote() {
	if (!noteTitle.value.trim()) return;

	await api.createActivity({
		kind: "note",
		title: noteTitle.value,
		body: noteBody.value || null,
		contactId: id.value,
		companyId: data.value?.contact.companyId ?? null,
	});

	noteTitle.value = "";
	noteBody.value = "";
	await refresh();
}

async function changeStage(dealId: string, stage: string) {
	await api.changeDealStage(dealId, stage);
	await refresh();
}
</script>

<template>
	<div class="crm-page">
		<div v-if="!data" class="crm-card">
			<el-empty description="联系人不存在或已被归档" />
		</div>

		<template v-else>
			<div class="crm-spread crm-section">
				<div>
					<h1 class="crm-title">
						{{ personName(data.contact) }}
						<el-tag v-if="data.researching" type="warning" effect="light" size="small">
							正在研究
						</el-tag>
					</h1>
					<div class="crm-muted">
						{{ data.contact.title ?? "职位未知" }}
						<template v-if="data.company">
							· <NuxtLink :to="`/companies/${data.company.id}`" class="crm-link">{{ data.company.name }}</NuxtLink>
						</template>
					</div>
				</div>
				<div class="crm-row">
					<el-button :loading="researchBusy" @click="research">重新研究</el-button>
					<el-button @click="showEdit = true">编辑</el-button>
					<el-popconfirm title="归档后不在列表显示，确定吗？" @confirm="archive">
						<template #reference>
							<el-button type="danger" plain>归档</el-button>
						</template>
					</el-popconfirm>
				</div>
			</div>

			<el-tabs v-model="activeTab">
				<el-tab-pane label="概览" name="overview">
					<div class="crm-grid">
						<section class="crm-card">
							<h2 class="crm-section__title">基本信息</h2>
							<el-descriptions :column="1" border>
								<el-descriptions-item label="邮箱">{{ data.contact.email ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="电话">{{ data.contact.phone ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="微信号">{{ data.contact.wechatId ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="地址">{{ data.contact.address ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="业务角色">{{ data.contact.businessRole ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="领英">{{ data.contact.linkedin ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="GitHub">{{ data.contact.github ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="最近研究">
									{{ data.contact.lastResearchedAt ? formatDateTime(data.contact.lastResearchedAt) : "尚未研究" }}
								</el-descriptions-item>
								<el-descriptions-item label="备注">
									<span class="crm-pre">{{ data.contact.notes ?? "—" }}</span>
								</el-descriptions-item>
								<el-descriptions-item v-for="fact in customFacts" :key="fact.id" :label="fieldLabels[fact.field] ?? fact.field">
									{{ fact.value }}
								</el-descriptions-item>
							</el-descriptions>
						</section>

						<section class="crm-card">
							<h2 class="crm-section__title">相关商机</h2>
							<el-empty v-if="data.deals.length === 0" description="还没有关联商机" :image-size="60" />
							<div v-for="deal in data.deals" :key="deal.id" class="crm-timeline-item crm-spread">
								<div>
									<NuxtLink :to="`/deals/${deal.id}`" class="crm-link">{{ deal.name }}</NuxtLink>
									<div class="crm-muted">{{ stageDuration(deal.stageChangedAt) }}</div>
								</div>
								<el-select
									:model-value="deal.stage"
									size="small"
									style="width: 120px"
									@change="(value: string) => changeStage(deal.id, value)"
								>
									<el-option v-for="stage in DEAL_STAGES" :key="stage" :label="stage" :value="stage" />
								</el-select>
							</div>
						</section>

						<section class="crm-card">
							<h2 class="crm-section__title">记一条活动</h2>
							<el-input v-model="noteTitle" placeholder="标题，例如：微信名片原文" maxlength="191" />
							<el-input
								v-model="noteBody"
								class="crm-note-body"
								type="textarea"
								:rows="4"
								placeholder="把客户原文、聊天记录、跟进情况贴在这里。它会进活动时间线，后台研究也从这里取证。"
							/>
							<el-button type="primary" @click="addNote">保存活动</el-button>
						</section>
					</div>
				</el-tab-pane>

				<el-tab-pane name="suggestions">
					<template #label>
						字段建议
						<el-badge
							v-if="
								data.facts.filter((fact) => fact.status === 'proposed').length +
									(fieldDefs?.fields ?? []).filter((field) => field.status === 'proposed').length >
								0
							"
							:value="
								data.facts.filter((fact) => fact.status === 'proposed').length +
								(fieldDefs?.fields ?? []).filter((field) => field.status === 'proposed').length
							"
						/>
					</template>
					<FieldProposals
						:fields="fieldDefs?.fields ?? []"
						:busy="factBusy"
						@decide="decideField"
					/>
					<FactSuggestions
						:facts="data.facts"
						:labels="fieldLabels"
						:busy="factBusy"
						@decide="decideFact"
					/>
				</el-tab-pane>

				<el-tab-pane label="活动时间线" name="timeline">
					<el-empty v-if="data.activities.length === 0" description="还没有活动" />
					<div v-for="activity in data.activities" :key="activity.id" class="crm-timeline-item">
						<div>
							<el-tag size="small" effect="plain">{{ ACTIVITY_KIND_LABELS[activity.kind] }}</el-tag>
							<span class="crm-activity-title">{{ activity.title }}</span>
							<el-button
								v-if="activity.kind === 'chat_log'"
								link
								type="primary"
								size="small"
								@click="activeTab = 'archive'"
							>
								看留底
							</el-button>
						</div>
						<div v-if="activity.body" class="crm-quote">{{ activity.body }}</div>
						<div class="crm-muted">
							{{ formatDateTime(activity.createdAt) }}
							<template v-if="activity.dueAt"> · 截止 {{ formatDateTime(activity.dueAt) }}</template>
						</div>
					</div>
				</el-tab-pane>

				<el-tab-pane name="archive">
					<template #label>
						聊天留底
						<el-badge v-if="data.archives.length > 0" :value="data.archives.length" />
					</template>

					<p class="crm-muted crm-archive__hint">
						历次导入的聊天原文，只读，不可编辑。原文存在会话记录里，不进备注、也不进活动正文 ——
						想回看当时聊到哪、隔了多久，从这里进。
					</p>

					<el-alert v-if="archiveError" type="error" :closable="false" show-icon :title="archiveError" />

					<el-empty v-if="data.archives.length === 0" description="还没有导入过聊天记录" />

					<div v-for="item in data.archives" :key="item.conversationId" class="crm-card crm-archive">
						<div class="crm-spread">
							<strong class="crm-archive__title">{{ item.title }}</strong>
							<el-button
								size="small"
								:loading="archiveBusy === item.conversationId"
								@click="toggleArchive(item)"
							>
								{{ openedArchive === item.conversationId ? "收起原文" : "查看原文" }}
							</el-button>
						</div>
						<div class="crm-muted crm-archive__meta">导入于 {{ formatDateTime(item.importedAt) }}</div>
						<p v-if="item.summary" class="crm-archive__summary">{{ item.summary }}</p>
						<pre v-if="openedArchive === item.conversationId" class="crm-archive__text">{{ archiveText }}</pre>
					</div>
				</el-tab-pane>

				<el-tab-pane label="Agent" name="agent" lazy>
					<AgentChat :contact-id="id" />
				</el-tab-pane>
			</el-tabs>

			<el-dialog v-model="showEdit" title="编辑联系人" width="520">
				<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
				<ContactForm
					:contact="data.contact"
					:submitting="submitting"
					@submit="editContact"
					@cancel="showEdit = false"
				/>
			</el-dialog>
		</template>
	</div>
</template>

<style scoped>
.crm-title {
	font-size: 20px;
	margin: 0 0 4px;
	display: flex;
	align-items: center;
	gap: 8px;
}

.crm-link {
	color: var(--crm-brand);
	text-decoration: none;
	font-weight: 500;
}

.crm-pre {
	white-space: pre-wrap;
}

.crm-note-body {
	margin: 8px 0;
}

.crm-activity-title {
	margin-left: 6px;
}

.crm-archive__hint {
	margin: 0 0 12px;
	line-height: 1.7;
}

.crm-archive {
	margin-bottom: 12px;
}

.crm-archive__title {
	font-size: 14px;
}

.crm-archive__meta {
	font-size: 12px;
	margin-top: 4px;
}

.crm-archive__summary {
	margin: 8px 0 0;
	line-height: 1.7;
	font-size: 13px;
}

.crm-archive__text {
	margin: 12px 0 0;
	padding: 12px;
	max-height: 460px;
	overflow: auto;
	background: var(--crm-surface);
	border-radius: 6px;
	font-size: 12px;
	line-height: 1.7;
	white-space: pre-wrap;
	word-break: break-word;
}
</style>
