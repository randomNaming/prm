<script setup lang="ts">
import { ACTIVITY_KIND_LABELS } from "~/types/domain";

const api = useApi();
const router = useRouter();
const { data, refresh } = await useAsyncData("dashboard", () => api.dashboard());

const showCreate = ref(false);
const submitting = ref(false);
const errorText = ref("");

const greeting = computed(() => {
	const hour = new Date().getHours();
	if (hour < 6) return "夜深了";
	if (hour < 12) return "早上好";
	if (hour < 18) return "下午好";

	return "晚上好";
});

async function createContact(payload: Record<string, unknown>) {
	submitting.value = true;
	errorText.value = "";

	try {
		const result = await api.createContact(payload);
		showCreate.value = false;
		await refresh();
		await router.push(`/contacts/${result.contact.id}`);
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败。";
	} finally {
		submitting.value = false;
	}
}

async function completeTask(id: string) {
	await api.decideActivity(id, "complete");
	await refresh();
}
</script>

<template>
	<div class="crm-page">
		<div class="crm-spread crm-section">
			<div>
				<h1 class="crm-greeting">{{ greeting }}</h1>
				<p class="crm-muted">这里是今天的推进情况。</p>
			</div>
			<el-button type="primary" @click="showCreate = true">新建联系人</el-button>
		</div>

		<div class="crm-grid">
			<section class="crm-card crm-section">
				<h2 class="crm-section__title">推进中的商机</h2>
				<el-empty
					v-if="!data || data.deals.length === 0"
					description="还没有推进中的商机"
					:image-size="64"
				/>
				<div v-for="deal in data?.deals ?? []" :key="deal.id" class="crm-timeline-item">
					<NuxtLink :to="`/deals/${deal.id}`" class="crm-link">{{ deal.name }}</NuxtLink>
					<div class="crm-muted">
						{{ deal.companyName ?? "未关联公司" }} · {{ deal.stage }} ·
						{{ stageDuration(deal.stageChangedAt) }}
						<template v-if="deal.expectedCloseDate">
							· 预计 {{ deal.expectedCloseDate }}
						</template>
					</div>
				</div>
			</section>

			<section class="crm-card crm-section">
				<h2 class="crm-section__title">已逾期任务</h2>
				<el-empty
					v-if="!data || data.tasks.length === 0"
					description="没有逾期任务"
					:image-size="64"
				/>
				<div v-for="task in data?.tasks ?? []" :key="task.id" class="crm-timeline-item crm-spread">
					<div>
						<div>{{ task.title }}</div>
						<div class="crm-muted">
							截止 {{ formatDateTime(task.dueAt) }}
							<template v-if="task.contactName"> · {{ task.contactName }}</template>
						</div>
					</div>
					<el-button size="small" @click="completeTask(task.id)">完成</el-button>
				</div>
			</section>

			<section class="crm-card crm-section">
				<h2 class="crm-section__title">近期活动</h2>
				<el-empty
					v-if="!data || data.activities.length === 0"
					description="还没有活动记录"
					:image-size="64"
				/>
				<div v-for="activity in data?.activities ?? []" :key="activity.id" class="crm-timeline-item">
					<div>
						<el-tag size="small" effect="plain">{{ ACTIVITY_KIND_LABELS[activity.kind] }}</el-tag>
						<span class="crm-activity-title">{{ activity.title }}</span>
					</div>
					<div class="crm-muted">
						{{ formatRelative(activity.createdAt) }}
						<template v-if="activity.contactName"> · {{ activity.contactName }}</template>
					</div>
				</div>
			</section>
		</div>

		<el-dialog v-model="showCreate" title="新建联系人" width="520">
			<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
			<ContactForm :submitting="submitting" @submit="createContact" @cancel="showCreate = false" />
		</el-dialog>
	</div>
</template>

<style scoped>
.crm-greeting {
	font-size: 22px;
	margin: 0 0 4px;
}

.crm-link {
	color: var(--crm-brand);
	text-decoration: none;
	font-weight: 500;
}

.crm-activity-title {
	margin-left: 6px;
}
</style>
