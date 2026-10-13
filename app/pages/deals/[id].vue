<script setup lang="ts">
import { DEAL_STAGES, DEAL_STATUS_LABELS } from "~/types/domain";

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
</script>

<template>
	<div class="crm-page">
		<div v-if="!data" class="crm-card">
			<el-empty description="商机不存在或已被归档" />
		</div>

		<template v-else>
			<div class="crm-spread crm-section">
				<div>
					<h1 class="crm-title">{{ data.deal.name }}</h1>
					<div class="crm-muted">
						{{ DEAL_STATUS_LABELS[data.deal.status] }} · {{ stageDuration(data.deal.stageChangedAt) }}
						<template v-if="data.company">
							·
							<NuxtLink :to="`/companies/${data.company.id}`" class="crm-link">
								{{ data.company.name }}
							</NuxtLink>
						</template>
					</div>
				</div>
				<div class="crm-row">
					<el-select
						:model-value="data.deal.stage"
						style="width: 140px"
						@change="(value: string) => changeStage(value)"
					>
						<el-option v-for="stage in DEAL_STAGES" :key="stage" :label="stage" :value="stage" />
					</el-select>
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
							<h2 class="crm-section__title">基本信息</h2>
							<el-descriptions :column="1" border>
								<el-descriptions-item label="阶段">{{ data.deal.stage }}</el-descriptions-item>
								<el-descriptions-item label="状态">{{ DEAL_STATUS_LABELS[data.deal.status] }}</el-descriptions-item>
								<el-descriptions-item label="预计成交日">{{ data.deal.expectedCloseDate ?? "—" }}</el-descriptions-item>
								<el-descriptions-item label="进入本阶段">
									{{ data.deal.stageChangedAt ? formatDateTime(data.deal.stageChangedAt) : "—" }}
								</el-descriptions-item>
								<el-descriptions-item label="联系人">
									<NuxtLink v-if="data.contact" :to="`/contacts/${data.contact.id}`" class="crm-link">
										{{ personName(data.contact) }}
									</NuxtLink>
									<span v-else>—</span>
								</el-descriptions-item>
							</el-descriptions>
						</section>

						<section class="crm-card">
							<h2 class="crm-section__title">阶段历史</h2>
							<el-empty
								v-if="data.activities.filter((item) => item.kind === 'stage_change').length === 0"
								description="还没有阶段变更"
								:image-size="60"
							/>
							<div
								v-for="activity in data.activities.filter((item) => item.kind === 'stage_change')"
								:key="activity.id"
								class="crm-timeline-item"
							>
								<div>{{ activity.title }}</div>
								<div class="crm-muted">{{ formatDateTime(activity.createdAt) }}</div>
							</div>
						</section>
					</div>
				</el-tab-pane>

				<el-tab-pane label="活动" name="timeline">
					<el-empty v-if="data.activities.length === 0" description="还没有活动" />
					<div v-for="activity in data.activities" :key="activity.id" class="crm-timeline-item">
						<div>{{ activity.title }}</div>
						<div v-if="activity.body" class="crm-quote">{{ activity.body }}</div>
						<div class="crm-muted">{{ formatDateTime(activity.createdAt) }}</div>
					</div>
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
.crm-title {
	font-size: 20px;
	margin: 0 0 4px;
}

.crm-link {
	color: var(--crm-brand);
	text-decoration: none;
	font-weight: 500;
}
</style>
