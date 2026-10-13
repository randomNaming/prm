<script setup lang="ts">
import { DEAL_STAGES, DEAL_STATUS_LABELS, type DealStage } from "~/types/domain";

const api = useApi();
const route = useRoute();
const router = useRouter();

const q = ref(String(route.query.q ?? ""));
const stage = ref(String(route.query.stage ?? ""));
const page = ref(Number(route.query.page ?? 1));
const showCreate = ref(false);
const submitting = ref(false);
const errorText = ref("");

const { data, refresh } = await useAsyncData(
	"deals-list",
	() => api.listDeals({ q: q.value, stage: stage.value || undefined, page: page.value }),
	{ watch: [q, stage, page] },
);

function search() {
	page.value = 1;
	router.replace({
		query: { q: q.value || undefined, stage: stage.value || undefined, page: page.value },
	});
}

async function createDeal(payload: Record<string, unknown>) {
	submitting.value = true;
	errorText.value = "";

	try {
		await api.createDeal(payload);
		showCreate.value = false;
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败。";
	} finally {
		submitting.value = false;
	}
}

const total = computed(() => data.value?.total ?? 0);
</script>

<template>
	<div class="crm-page">
		<div class="crm-spread crm-section">
			<h1 class="crm-title">商机</h1>
			<el-button type="primary" @click="showCreate = true">新建商机</el-button>
		</div>

		<div class="crm-row crm-section">
			<el-input
				v-model="q"
				placeholder="按商机名称搜索（子串匹配）"
				style="max-width: 300px"
				clearable
				@keyup.enter="search"
				@clear="search"
			/>
			<el-select v-model="stage" clearable placeholder="全部阶段" style="width: 160px" @change="search">
				<el-option v-for="item in DEAL_STAGES" :key="item" :label="item" :value="item" />
			</el-select>
			<el-button @click="search">搜索</el-button>
		</div>

		<el-table v-if="total > 0" :data="data?.items ?? []" style="width: 100%">
			<el-table-column label="商机" min-width="180">
				<template #default="{ row }">
					<NuxtLink :to="`/deals/${row.id}`" class="crm-link">{{ row.name }}</NuxtLink>
				</template>
			</el-table-column>
			<el-table-column label="阶段" min-width="110">
				<template #default="{ row }">
					<el-tag size="small" effect="plain">{{ row.stage }}</el-tag>
				</template>
			</el-table-column>
			<el-table-column label="状态" min-width="100">
				<template #default="{ row }">{{ DEAL_STATUS_LABELS[row.status as never] }}</template>
			</el-table-column>
			<el-table-column label="停留" min-width="120">
				<template #default="{ row }">{{ stageDuration(row.stageChangedAt) }}</template>
			</el-table-column>
			<el-table-column prop="expectedCloseDate" label="预计成交" min-width="120" />
		</el-table>

		<el-empty v-else description="还没有商机，新建一个" />

		<el-pagination
			v-if="total > 20"
			class="crm-pagination"
			layout="prev, pager, next"
			:total="total"
			:page-size="20"
			:current-page="page"
			@current-change="(value: number) => (page = value)"
		/>

		<el-dialog v-model="showCreate" title="新建商机" width="520">
			<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
			<DealForm :submitting="submitting" @submit="createDeal" @cancel="showCreate = false" />
		</el-dialog>
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

.crm-pagination {
	margin-top: 16px;
	justify-content: flex-end;
}
</style>
