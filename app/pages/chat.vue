<script setup lang="ts">
const api = useApi();
const query = ref("");
const hits = ref<{ type: string; id: string; label: string; detail: string }[]>([]);
const searched = ref(false);

const typeLabels: Record<string, string> = {
	contact: "联系人",
	company: "公司",
	deal: "商机",
};

const typePaths: Record<string, string> = {
	contact: "/contacts",
	company: "/companies",
	deal: "/deals",
};

async function runSearch() {
	if (!query.value.trim()) {
		hits.value = [];
		searched.value = false;

		return;
	}

	const result = await api.search(query.value);
	hits.value = result.hits;
	searched.value = true;
}
</script>

<template>
	<div class="crm-page">
		<h1 class="crm-title crm-section">智能体</h1>

		<div class="crm-grid">
			<section class="crm-card">
				<h2 class="crm-section__title">全局对话</h2>
				<p class="crm-muted">这里没有记录上下文，适合问跨记录的通用问题。</p>
				<AgentChat />
			</section>

			<section class="crm-card">
				<h2 class="crm-section__title">按子串查库</h2>
				<div class="crm-row">
					<el-input
						v-model="query"
						placeholder="姓名、邮箱、微信号、公司名、商机名"
						clearable
						@keyup.enter="runSearch"
					/>
					<el-button @click="runSearch">搜索</el-button>
				</div>
				<div v-for="hit in hits" :key="`${hit.type}-${hit.id}`" class="crm-timeline-item">
					<el-tag size="small" effect="plain">{{ typeLabels[hit.type] }}</el-tag>
					<NuxtLink :to="`${typePaths[hit.type]}/${hit.id}`" class="crm-link crm-hit-label">
						{{ hit.label }}
					</NuxtLink>
					<div class="crm-muted">{{ hit.detail }}</div>
				</div>
				<el-empty
					v-if="searched && hits.length === 0"
					description="没有匹配的记录（只做子串匹配）"
					:image-size="60"
				/>
			</section>
		</div>
	</div>
</template>

<style scoped>
.crm-title {
	font-size: 20px;
	margin: 0;
}

.crm-link {
	color: var(--crm-brand);
	text-decoration: none;
	font-weight: 500;
}

.crm-hit-label {
	margin-left: 6px;
}
</style>
