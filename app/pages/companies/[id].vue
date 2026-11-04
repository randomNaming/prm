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

// cooperation_role 有独立数据库列，「公司资料」里已单独渲染，不再挤进自定义字段区重复一遍。
const BUILTIN_KEYS = new Set<string>([...COMPANY_FACT_FIELDS, "cooperation_role"]);

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
	() =>
		(fieldDefs.value?.fields ?? []).filter(
			(field) =>
				field.status === "proposed" && (!field.sampleRef || field.sampleRef === id.value),
		).length,
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

/** 卡死的后台研究允许人工终止；正在跑的那一次会被请求级超时兜住很快退出。 */
const cancelBusy = ref(false);

async function cancelResearch() {
	cancelBusy.value = true;

	try {
		await api.cancelResearch("company", id.value);
		await refresh();
	} finally {
		cancelBusy.value = false;
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

async function decideFact(payload: { id: string; action: "accept" | "reject" | "revert" }) {
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

/** 中文公司名取前两个字，英文名取首字母，和联系人头像的做法保持一致。 */
const companyInitials = computed(() => {
	const name = data.value?.company.name?.trim() ?? "";

	if (!name) return "—";
	if (/^[A-Za-z]/.test(name)) {
		return (
			name
				.split(/\s+/)
				.filter(Boolean)
				.slice(0, 2)
				.map((word) => word.charAt(0).toUpperCase())
				.join("") || "—"
		);
	}

	return name.slice(0, 2);
});

const profileRows = computed(() => {
	const company = data.value?.company;

	if (!company) return [];

	return [
		{ label: "合作角色", value: company.cooperationRole ?? "—" },
		{ label: "行业", value: company.industry ?? "—" },
		{ label: "官网域名", value: company.domain ?? "—" },
		{ label: "公司地址", value: company.address ?? "—" },
	];
});
</script>

<template>
	<div class="cvd crm-page">
		<div v-if="!data" class="cvd-card">
			<el-empty description="公司不存在或已被归档" />
		</div>

		<template v-else>
			<header class="cvd-head">
				<div class="cvd-avatar cvd-avatar--square">{{ companyInitials }}</div>

				<div class="cvd-head__main">
					<div class="cvd-head__name">
						<h1>{{ data.company.name }}</h1>
						<span v-if="data.company.cooperationRole" class="cvd-chip">{{ data.company.cooperationRole }}</span>
						<span v-if="data.company.industry" class="cvd-chip cvd-chip--plain">{{ data.company.industry }}</span>
						<el-popconfirm
							v-if="data.researching"
							title="终止这项后台研究？"
							confirm-button-text="终止"
							cancel-button-text="再等等"
							@confirm="cancelResearch"
						>
							<template #reference>
								<el-tooltip content="研究超过几分钟没结束多半是卡住了，点这里终止；之后可再点「重新研究」重跑。" placement="top">
									<el-link type="warning" :underline="false">正在研究，点此终止</el-link>
								</el-tooltip>
							</template>
						</el-popconfirm>
					</div>

					<div class="cvd-head__meta">
						<span>{{ data.contacts.length }} 位对接人</span>
						<span v-if="data.deals.length" class="cvd-sep">·</span>
						<span v-if="data.deals.length">{{ data.deals.length }} 个商机</span>
						<template v-if="data.company.domain">
							<span class="cvd-sep">·</span>
							<span>{{ data.company.domain }}</span>
						</template>
						<template v-if="data.company.address">
							<span class="cvd-sep">·</span>
							<span>{{ data.company.address }}</span>
						</template>
					</div>
				</div>

				<div class="cvd-head__actions">
					<button class="cvd-btn cvd-btn--primary" :disabled="researchBusy" @click="research">
						{{ researchBusy ? "研究中…" : "重新研究" }}
					</button>
					<button class="cvd-btn" @click="showEdit = true">编辑</button>
					<el-popconfirm title="归档后不在列表显示，确定吗？" @confirm="archive">
						<template #reference>
							<button class="cvd-btn cvd-btn--danger">归档</button>
						</template>
					</el-popconfirm>
				</div>
			</header>

			<el-tabs model-value="overview">
				<el-tab-pane label="概览" name="overview">
					<div class="cvd-detail-cols">
						<section class="cvd-card">
							<div class="cvd-card__head">
								<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 21V7l8-4 8 4v14" /><path d="M9 21v-5h6v5" /><path d="M9 10h.01M15 10h.01" /></svg>
								<span class="cvd-card__title">公司资料</span>
								<span v-if="customFacts.length" class="cvd-card__meta">{{ customFacts.length }} 个自定义字段</span>
							</div>

							<div v-for="row in profileRows" :key="row.label" class="cvd-kv">
								<div class="cvd-kv__k">{{ row.label }}</div>
								<div class="cvd-kv__v">{{ row.value }}</div>
							</div>
							<div class="cvd-kv">
								<div class="cvd-kv__k">主营介绍</div>
								<div class="cvd-kv__v cvd-pre">{{ data.company.description ?? "—" }}</div>
							</div>
							<div v-for="fact in customFacts" :key="fact.id" class="cvd-kv">
								<div class="cvd-kv__k">{{ fieldLabels[fact.field] ?? fact.field }}</div>
								<div class="cvd-kv__v">{{ fact.value }}</div>
							</div>
						</section>

						<div class="cvd-col">
							<section class="cvd-card">
								<div class="cvd-card__head">
									<svg class="cvd-ico" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4S18.3 16.4 19.5 20" /></svg>
									<span class="cvd-card__title">公司联系人</span>
									<span class="cvd-card__meta">{{ data.contacts.length }} 位</span>
								</div>
								<ul v-if="data.contacts.length" class="cvd-tl">
									<li v-for="person in data.contacts" :key="person.id">
										<div class="cvd-tl__body">
											<div class="cvd-tl__title">
												<NuxtLink :to="`/contacts/${person.id}`" class="cvd-link">{{ personName(person) }}</NuxtLink>
											</div>
											<div class="cvd-tl__time">{{ person.title ?? "职位未知" }}</div>
										</div>
									</li>
								</ul>
								<div v-else class="cvd-muted cvd-card__empty">还没有联系人。</div>
							</section>

							<section class="cvd-card">
								<div class="cvd-card__head">
									<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 7h16v12H4z" /><path d="M8 7V5h8v2" /><path d="M8 13h8" /></svg>
									<span class="cvd-card__title">相关商机</span>
									<span class="cvd-card__meta">{{ data.deals.length }} 个</span>
								</div>
								<ul v-if="data.deals.length" class="cvd-tl">
									<li v-for="deal in data.deals" :key="deal.id">
										<div class="cvd-tl__body">
											<div class="cvd-tl__title">
												<NuxtLink :to="`/deals/${deal.id}`" class="cvd-link">{{ deal.name }}</NuxtLink>
											</div>
											<div class="cvd-tl__time">{{ deal.stage }} · {{ stageDuration(deal.stageChangedAt) }}</div>
										</div>
										<span class="cvd-pill cvd-pill--plan">{{ deal.stage }}</span>
									</li>
								</ul>
								<div v-else class="cvd-muted cvd-card__empty">还没有商机。</div>
							</section>
						</div>
					</div>
				</el-tab-pane>

				<el-tab-pane name="suggestions">
					<template #label>
						字段建议
						<span
							v-if="data.facts.filter((fact) => fact.status === 'proposed').length + proposedFieldCount > 0"
							class="cvd-tabcount"
						>
							{{ data.facts.filter((fact) => fact.status === 'proposed').length + proposedFieldCount }}
						</span>
					</template>
					<FieldProposals
						:fields="fieldDefs?.fields ?? []"
						:record-id="id"
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
					<section class="cvd-card cvd-panel">
						<div class="cvd-card__head">
							<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h11M4 18h7" /></svg>
							<span class="cvd-card__title">活动时间线</span>
							<span class="cvd-card__meta">共 {{ data.activities.length }} 条</span>
						</div>
						<div v-for="activity in data.activities" :key="activity.id" class="cvd-beat">
							<div class="cvd-beat__body">
								<div class="cvd-beat__title">{{ activity.title }}</div>
								<div class="cvd-beat__time">{{ formatDateTime(activity.createdAt) }}</div>
							</div>
							<span class="cvd-pill cvd-pill--plan">{{ ACTIVITY_KIND_LABELS[activity.kind] }}</span>
						</div>
						<div v-if="!data.activities.length" class="cvd-muted cvd-card__empty">还没有活动。</div>
					</section>
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
.cvd-card__empty {
	padding: 12px 0 4px;
}

/*
 * 联系人的键值列是两字标签（邮箱/电话），公司资料的标签是四到五字
 * （合作角色/官网域名/主营介绍），这里单独放宽，避免换行。
 */
.cvd-kv__k {
	width: 68px;
}

.cvd-tabcount {
	margin-left: 5px;
	font-size: 10px;
	font-weight: 600;
	line-height: 1.5;
	padding: 0 5px;
	border-radius: 999px;
	background: var(--warn-bg);
	color: var(--warn);
}
</style>
