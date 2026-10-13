<script setup lang="ts">
import type { CompanyListItem } from "~/types/domain";
import {
	COMPANY_BUILTIN_FIELD_KEYS,
	COMPANY_COLUMNS,
	customColumns,
	type ListColumn,
} from "~/utils/list-columns";

const api = useApi();
const route = useRoute();
const router = useRouter();

const q = ref(String(route.query.q ?? ""));
const page = ref(Number(route.query.page ?? 1));
const archived = ref(route.query.archived === "true");
const showCreate = ref(false);
const submitting = ref(false);
const errorText = ref("");

const { data, refresh } = await useAsyncData(
	"companies-list",
	() => api.listCompanies({ q: q.value, page: page.value, archived: archived.value }),
	{ watch: [q, page, archived] },
);

const { data: fieldDefs } = await useAsyncData("company-list-fields", () => api.fields("company"));

const columns = computed<ListColumn<CompanyListItem>[]>(() => [
	...COMPANY_COLUMNS,
	...customColumns<CompanyListItem>(
		fieldDefs.value?.fields ?? [],
		"company",
		COMPANY_BUILTIN_FIELD_KEYS,
	),
]);

const { visible, visibleColumns, setVisible, reset } = useTableColumns(
	"crm.columns.company",
	columns,
);

function syncQuery() {
	router.replace({
		query: {
			q: q.value || undefined,
			page: page.value,
			archived: archived.value ? "true" : undefined,
		},
	});
}

function search() {
	page.value = 1;
	syncQuery();
}

function toggleArchived(value: boolean) {
	page.value = 1;
	archived.value = value;
	syncQuery();
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

// el-table 的插槽行类型是 DefaultRow，拿不到具体行类型，在这里收口一次。
async function remove(row: unknown) {
	const item = row as CompanyListItem;

	try {
		await api.archiveCompany(item.id);
		ElMessage.success(`已删除${item.name}，可在「显示已归档」里恢复。`);
		await refresh();
	} catch (error) {
		ElMessage.error(error instanceof Error ? error.message : "删除失败。");
	}
}

async function restore(row: unknown) {
	const item = row as CompanyListItem;

	try {
		await api.restoreCompany(item.id);
		ElMessage.success(`已恢复${item.name}。`);
		await refresh();
	} catch (error) {
		ElMessage.error(error instanceof Error ? error.message : "恢复失败。");
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

		<div class="crm-spread crm-section">
			<div class="crm-row">
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
			<div class="crm-row">
				<el-switch
					:model-value="archived"
					active-text="显示已归档"
					@update:model-value="(value: string | number | boolean) => toggleArchived(Boolean(value))"
				/>
				<ColumnPicker
					:columns="columns"
					:model-value="visible"
					@update:model-value="setVisible"
					@reset="reset"
				/>
			</div>
		</div>

		<RecordTable v-if="total > 0" :columns="visibleColumns" :rows="data?.items ?? []">
			<template #actions>
				<el-table-column label="操作" width="90" fixed="right">
					<template #default="{ row }">
						<el-popconfirm
							v-if="!archived"
							width="260"
							title="删除后不再出现在列表，可在「显示已归档」里恢复。确定删除？"
							confirm-button-text="删除"
							cancel-button-text="取消"
							confirm-button-type="danger"
							@confirm="remove(row)"
						>
							<template #reference>
								<el-button link type="danger" size="small">删除</el-button>
							</template>
						</el-popconfirm>
						<el-button v-else link type="primary" size="small" @click="restore(row)">恢复</el-button>
					</template>
				</el-table-column>
			</template>
		</RecordTable>

		<el-empty v-else :description="archived ? '没有已归档的公司' : '还没有公司，新建一个'" />

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

.crm-pagination {
	margin-top: 16px;
	justify-content: flex-end;
}
</style>
