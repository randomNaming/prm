<script setup lang="ts">
import { ACTIVITY_KIND_LABELS, DEAL_STAGES, DEAL_STATUS_LABELS } from "~/types/domain";

const api = useApi();
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));

const { data, refresh } = await useAsyncData(`deal-${id.value}`, () => api.dealDetail(id.value));

const showEdit = ref(false);
const submitting = ref(false);
const errorText = ref("");

async function editDeal(payload: Record<string, unknown>) {
	submitting.value = true;
	errorText.value = "";

	try {
		await api.updateDeal(id.value, payload);
		showEdit.value = false;
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败。";
	} finally {
		submitting.value = false;
	}
}

async function changeStage(value: string) {
	await api.changeDealStage(id.value, value);
	await refresh();
}

async function archive() {
	await api.archiveDeal(id.value);
	await router.push("/deals");
}

const stageChanges = computed(
	() => data.value?.activities.filter((item) => item.kind === "stage_change") ?? [],
);

const statusClass = computed(() => {
	const status = data.value?.deal.status;

	if (status === "won") return "cvd-chip--won";
	if (status === "shelved") return "cvd-chip--shelved";

	return "cvd-chip--plain";
});
</script>

<template>
	<div class="cvd crm-page">
		<div v-if="!data" class="cvd-card">
			<el-empty description="商机不存在或已被归档" />
		</div>

		<template v-else>
			<header class="cvd-head">
				<div class="cvd-avatar cvd-avatar--square cvd-avatar--deal">
					<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 7h16v12H4z" /><path d="M8 7V5h8v2" /><path d="M8 13h8" /></svg>
				</div>

				<div class="cvd-head__main">
					<div class="cvd-head__name">
						<h1>{{ data.deal.name }}</h1>
						<span class="cvd-chip">{{ data.deal.stage }}</span>
						<span class="cvd-chip" :class="statusClass">{{ DEAL_STATUS_LABELS[data.deal.status] }}</span>
					</div>

					<div class="cvd-head__meta">
						<span>{{ stageDuration(data.deal.stageChangedAt) }}</span>
						<template v-if="data.deal.expectedCloseDate">
							<span class="cvd-sep">·</span>
							<span>预计成交 {{ data.deal.expectedCloseDate }}</span>
						</template>
						<template v-if="data.company">
							<span class="cvd-sep">·</span>
							<NuxtLink :to="`/companies/${data.company.id}`" class="cvd-link">{{ data.company.name }}</NuxtLink>
						</template>
						<template v-if="data.contact">
							<span class="cvd-sep">·</span>
							<NuxtLink :to="`/contacts/${data.contact.id}`" class="cvd-link">{{ personName(data.contact) }}</NuxtLink>
						</template>
					</div>
				</div>

				<div class="cvd-head__actions">
					<el-select
						:model-value="data.deal.stage"
						style="width: 132px"
						@change="(value: string) => changeStage(value)"
					>
						<el-option v-for="stage in DEAL_STAGES" :key="stage" :label="stage" :value="stage" />
					</el-select>
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
								<svg class="cvd-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="M12 8v4l2.5 1.8" /></svg>
								<span class="cvd-card__title">基本信息</span>
								<span class="cvd-card__meta">{{ stageChanges.length }} 次阶段变更</span>
							</div>

							<div class="cvd-kv">
								<div class="cvd-kv__k">阶段</div>
								<div class="cvd-kv__v">{{ data.deal.stage }}</div>
							</div>
							<div class="cvd-kv">
								<div class="cvd-kv__k">状态</div>
								<div class="cvd-kv__v">{{ DEAL_STATUS_LABELS[data.deal.status] }}</div>
							</div>
							<div class="cvd-kv">
								<div class="cvd-kv__k">预计成交</div>
								<div class="cvd-kv__v">{{ data.deal.expectedCloseDate ?? "—" }}</div>
							</div>
							<div class="cvd-kv">
								<div class="cvd-kv__k">进入本阶段</div>
								<div class="cvd-kv__v">
									{{ data.deal.stageChangedAt ? formatDateTime(data.deal.stageChangedAt) : "—" }}
								</div>
							</div>
							<div class="cvd-kv">
								<div class="cvd-kv__k">联系人</div>
								<div class="cvd-kv__v">
									<NuxtLink v-if="data.contact" :to="`/contacts/${data.contact.id}`" class="cvd-link">
										{{ personName(data.contact) }}
									</NuxtLink>
									<span v-else class="cvd-muted">—</span>
								</div>
							</div>
							<div class="cvd-kv">
								<div class="cvd-kv__k">所属公司</div>
								<div class="cvd-kv__v">
									<NuxtLink v-if="data.company" :to="`/companies/${data.company.id}`" class="cvd-link">
										{{ data.company.name }}
									</NuxtLink>
									<span v-else class="cvd-muted">—</span>
								</div>
							</div>
						</section>

						<section class="cvd-card">
							<div class="cvd-card__head">
								<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 12h11" /><path d="M12 6l6 6-6 6" /></svg>
								<span class="cvd-card__title">阶段历史</span>
								<span class="cvd-card__meta">共 {{ stageChanges.length }} 次</span>
							</div>
							<div v-for="activity in stageChanges" :key="activity.id" class="cvd-beat">
								<div class="cvd-beat__body">
									<div class="cvd-beat__title">{{ activity.title }}</div>
									<div class="cvd-beat__time">{{ formatDateTime(activity.createdAt) }}</div>
								</div>
							</div>
							<div v-if="!stageChanges.length" class="cvd-muted cvd-card__empty">还没有阶段变更。</div>
						</section>
					</div>
				</el-tab-pane>

				<el-tab-pane label="活动" name="timeline">
					<section class="cvd-card cvd-panel">
						<div class="cvd-card__head">
							<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h11M4 18h7" /></svg>
							<span class="cvd-card__title">活动</span>
							<span class="cvd-card__meta">共 {{ data.activities.length }} 条</span>
						</div>
						<div v-for="activity in data.activities" :key="activity.id" class="cvd-beat">
							<div class="cvd-beat__body">
								<div class="cvd-beat__title">{{ activity.title }}</div>
								<div v-if="activity.body" class="cvd-beat__quote">{{ activity.body }}</div>
								<div class="cvd-beat__time">{{ formatDateTime(activity.createdAt) }}</div>
							</div>
							<span class="cvd-pill cvd-pill--plan">{{ ACTIVITY_KIND_LABELS[activity.kind] }}</span>
						</div>
						<div v-if="!data.activities.length" class="cvd-muted cvd-card__empty">还没有活动。</div>
					</section>
				</el-tab-pane>

				<el-tab-pane label="Agent" name="agent" lazy>
					<AgentChat :deal-id="id" />
				</el-tab-pane>
			</el-tabs>

			<el-dialog v-model="showEdit" title="编辑商机" width="520">
				<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
				<DealForm
					:deal="data.deal"
					:submitting="submitting"
					@submit="editDeal"
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

/* 商机的标签更长（预计成交 / 进入本阶段），键值列相应放宽 */
.cvd-kv__k {
	width: 68px;
}

.cvd-chip--won {
	background: var(--ok-bg);
	color: var(--ok);
}

.cvd-chip--shelved {
	background: var(--grey-bg);
	color: #7b8494;
}

.cvd-beat__quote {
	margin-top: 4px;
	padding: 6px 10px;
	background: #fbfbfd;
	border-left: 3px solid #e4e9f2;
	border-radius: 0 6px 6px 0;
	font-size: 12px;
	line-height: 1.65;
	color: #59616e;
	white-space: pre-wrap;
}
</style>
