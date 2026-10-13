<script setup lang="ts">
import {
	ACTIVITY_KIND_LABELS,
	COMPANY_FACT_FIELDS,
	COMPANY_FACT_FIELD_LABELS,
} from "~/types/domain";

const api = useApi();
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));

const { data, refresh } = await useAsyncData(`company-${id.value}`, () =>
	api.companyDetail(id.value),
);

const { data: fieldDefs, refresh: refreshFields } = await useAsyncData(`company-fields`, () =>
	api.fields("company"),
);

const BUILTIN_KEYS = new Set<string>(COMPANY_FACT_FIELDS);

const fieldLabels = computed(() => {
	const labels: Record<string, string> = { ...COMPANY_FACT_FIELD_LABELS };

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

const proposedFieldCount = computed(
	() => (fieldDefs.value?.fields ?? []).filter((field) => field.status === "proposed").length,
);

const showEdit = ref(false);
const submitting = ref(false);
const errorText = ref("");
const factBusy = ref(false);
const researchBusy = ref(false);

async function research() {
	researchBusy.value = true;

	try {
		await api.research("company", id.value);
		await refresh();
	} finally {
		researchBusy.value = false;
	}
}

async function editCompany(payload: Record<string, unknown>) {
	submitting.value = true;
	errorText.value = "";

	try {
		await api.updateCompany(id.value, payload);
		showEdit.value = false;
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败。";
	} finally {
		submitting.value = false;
	}
}

async function decideFact(payload: { id: string; action: "accept" | "reject" }) {
	factBusy.value = true;

	try {
		await api.decideFact(payload.id, payload.action, "company");
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

async function archive() {
	await api.archiveCompany(id.value);
	await router.push("/companies");
}
</script>

<template>
	<div class="crm-page">
		<div v-if="!data" class="crm-card">
			<el-empty description="公司不存在或已被归档" />
		</div>

		<template v-else>
			<div class="crm-spread crm-section">
				<div>
					<h1 class="crm-title">
						{{ data.company.name }}
						<el-tag v-if="data.researching" type="warning" effect="light" size="small">
							正在研究
						</el-tag>
					</h1>
					<div class="crm-muted">
						{{ data.company.industry ?? "行业未知" }}
						<template v-if="data.company.domain"> · {{ data.company.domain }}</template>
						<template v-if="data.company.address"> · {{ data.company.address }}</template>
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

			<el-tabs model-value="overview">
				<el-tab-pane label="概览" name="overview">
					<div class="crm-grid">
						<section class="crm-card">
							<h2 class="crm-section__title">公司联系人（{{ data.contacts.length }}）</h2>
							<el-empty v-if="data.contacts.length === 0" description="还没有联系人" :image-size="60" />
							<div v-for="person in data.contacts" :key="person.id" class="crm-timeline-item">
								<NuxtLink :to="`/contacts/${person.id}`" class="crm-link">
									{{ personName(person) }}
								</NuxtLink>
								<div class="crm-muted">{{ person.title ?? "职位未知" }}</div>
							</div>
						</section>

						<section class="crm-card">
							<h2 class="crm-section__title">相关商机</h2>
							<el-empty v-if="data.deals.length === 0" description="还没有商机" :image-size="60" />
							<div v-for="deal in data.deals" :key="deal.id" class="crm-timeline-item">
								<NuxtLink :to="`/deals/${deal.id}`" class="crm-link">{{ deal.name }}</NuxtLink>
								<div class="crm-muted">{{ deal.stage }} · {{ stageDuration(deal.stageChangedAt) }}</div>
							</div>
						</section>

						<section class="crm-card">
							<h2 class="crm-section__title">公司资料</h2>
							<el-descriptions :column="1" border>
								<el-descriptions-item label="合作角色">{{ data.company.cooperationRole ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="行业">{{ data.company.industry ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="公司地址">{{ data.company.address ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="官网域名">{{ data.company.domain ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="主营介绍">
									<span class="crm-pre">{{ data.company.description ?? "—" }}</span>
								</el-descriptions-item>
								<el-descriptions-item v-for="fact in customFacts" :key="fact.id" :label="fieldLabels[fact.field] ?? fact.field">
									{{ fact.value }}
								</el-descriptions-item>
							</el-descriptions>
						</section>

						<section class="crm-card">
							<h2 class="crm-section__title">公司联系人（{{ data.contacts.length }}）</h2>
							<el-empty v-if="data.contacts.length === 0" description="还没有联系人" :image-size="60" />
							<div v-for="person in data.contacts" :key="person.id" class="crm-timeline-item">
								<NuxtLink :to="`/contacts/${person.id}`" class="crm-link">
									{{ personName(person) }}
								</NuxtLink>
								<div class="crm-muted">{{ person.title ?? "职位未知" }}</div>
							</div>
						</section>
					</div>
				</el-tab-pane>

				<el-tab-pane name="suggestions">
					<template #label>
						字段建议
						<el-badge
							v-if="
								data.facts.filter((fact) => fact.status === 'proposed').length +
									proposedFieldCount >
								0
							"
							:value="
								data.facts.filter((fact) => fact.status === 'proposed').length +
								proposedFieldCount
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
						</div>
						<div class="crm-muted">{{ formatDateTime(activity.createdAt) }}</div>
					</div>
				</el-tab-pane>

				<el-tab-pane label="Agent" name="agent" lazy>
					<AgentChat :company-id="id" />
				</el-tab-pane>
			</el-tabs>

			<el-dialog v-model="showEdit" title="编辑公司" width="520">
				<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
				<CompanyForm
					:company="data.company"
					:submitting="submitting"
					@submit="editCompany"
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
}

.crm-link {
	color: var(--crm-brand);
	text-decoration: none;
	font-weight: 500;
}

.crm-pre {
	white-space: pre-wrap;
}

.crm-activity-title {
	margin-left: 6px;
}
</style>
