<script setup lang="ts">
import { ACTIVITY_KIND_LABELS } from "~/types/domain";

const api = useApi();
const { data } = await useAsyncData("dashboard", () => api.dashboard());

const greeting = computed(() => {
	const hour = new Date().getHours();
	if (hour < 6) return "夜深了";
	if (hour < 12) return "早上好";
	if (hour < 18) return "下午好";

	return "晚上好";
});
</script>

<template>
	<div class="crm-page">
		<div class="crm-section">
			<h1 class="crm-greeting">{{ greeting }}</h1>
		</div>

		<EisenhowerBoard class="crm-section" />

		<section class="crm-card">
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
</template>

<style scoped>
.crm-greeting {
	font-size: 22px;
	margin: 0 0 4px;
}

.crm-activity-title {
	margin-left: 6px;
}
</style>
