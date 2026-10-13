<script setup lang="ts">
const api = useApi();
const route = useRoute();
const router = useRouter();

const q = ref(String(route.query.q ?? ""));
const page = ref(Number(route.query.page ?? 1));
const showCreate = ref(false);
const submitting = ref(false);
const errorText = ref("");

const { data, refresh } = await useAsyncData(
	"companies-list",
	() => api.listCompanies({ q: q.value, page: page.value }),
	{ watch: [q, page] },
);

function search() {
	page.value = 1;
	router.replace({ query: { q: q.value || undefined, page: page.value } });
}

async function createCompany(payload: Record<string, unknown>) {
	submitting.value = true;
	errorText.value = "";

	try {
		await api.createCompany(payload);
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
			<h1 class="crm-title">公司</h1>
			<el-button type="primary" @click="showCreate = true">新建公司</el-button>
		</div>

		<div class="crm-row crm-section">
			<el-input
				v-model="q"
				placeholder="按公司名或域名搜索（子串匹配）"
				style="max-width: 360px"
				clearable
				@keyup.enter="search"
				@clear="search"
			/>
			<el-button @click="search">搜索</el-button>
		</div>

		<el-table v-if="total > 0" :data="data?.items ?? []" style="width: 100%">
			<el-table-column label="公司名" min-width="180">
				<template #default="{ row }">
					<NuxtLink :to="`/companies/${row.id}`" class="crm-link">{{ row.name }}</NuxtLink>
				</template>
			</el-table-column>
			<el-table-column prop="industry" label="行业" min-width="140" />
			<el-table-column prop="domain" label="域名" min-width="160" />
			<el-table-column label="最近更新" min-width="130">
				<template #default="{ row }">{{ formatRelative(row.updatedAt) }}</template>
			</el-table-column>
		</el-table>

		<el-empty v-else description="还没有公司，新建一个" />

		<el-pagination
			v-if="total > 20"
			class="crm-pagination"
			layout="prev, pager, next"
			:total="total"
			:page-size="20"
			:current-page="page"
			@current-change="(value: number) => (page = value)"
		/>

		<el-dialog v-model="showCreate" title="新建公司" width="520">
			<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
			<CompanyForm :submitting="submitting" @submit="createCompany" @cancel="showCreate = false" />
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
