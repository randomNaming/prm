<script setup lang="ts">
import type { ContactListItem } from "~/types/domain";
import { RELATIONSHIP_BLANK } from "~/types/domain";
import {
	CONTACT_BUILTIN_FIELD_KEYS,
	CONTACT_COLUMNS,
	customColumns,
	type ListColumn,
} from "~/utils/list-columns";

const api = useApi();
const route = useRoute();
const router = useRouter();

const q = ref(String(route.query.q ?? ""));
const page = ref(Number(route.query.page ?? 1));
const archived = ref(route.query.archived === "true");
const relationship = ref(String(route.query.relationship ?? ""));
const showCreate = ref(false);
const submitting = ref(false);
const errorText = ref("");

const { data, refresh } = await useAsyncData(
	"contacts-list",
	() =>
		api.listContacts({
			q: q.value,
			page: page.value,
			archived: archived.value,
			relationship: relationship.value || undefined,
		}),
	{ watch: [q, page, archived, relationship] },
);

const { data: fieldDefs } = await useAsyncData("contact-list-fields", () => api.fields("contact"));

const relationshipOptions = computed(
	() =>
		fieldDefs.value?.fields.find((field) => field.key === "relationship_state")?.options ?? [],
);

const columns = computed<ListColumn<ContactListItem>[]>(() => [
	...CONTACT_COLUMNS,
	...customColumns<ContactListItem>(
		fieldDefs.value?.fields ?? [],
		"contact",
		CONTACT_BUILTIN_FIELD_KEYS,
	),
]);

const { visible, visibleColumns, setVisible, reset } = useTableColumns(
	"crm.columns.contact",
	columns,
);

function syncQuery() {
	router.replace({
		query: {
			q: q.value || undefined,
			page: page.value,
			archived: archived.value ? "true" : undefined,
			relationship: relationship.value || undefined,
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

async function createContact(payload: Record<string, unknown>) {
	submitting.value = true;
	errorText.value = "";

	try {
		await api.createContact(payload);
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
	const item = row as ContactListItem;

	try {
		await api.archiveContact(item.id);
		ElMessage.success(`已删除${personName(item)}，可在「显示已归档」里恢复。`);
		await refresh();
	} catch (error) {
		ElMessage.error(error instanceof Error ? error.message : "删除失败。");
	}
}

async function restore(row: unknown) {
	const item = row as ContactListItem;

	try {
		await api.restoreContact(item.id);
		ElMessage.success(`已恢复${personName(item)}。`);
		await refresh();
	} catch (error) {
		ElMessage.error(error instanceof Error ? error.message : "恢复失败。");
	}
}

const total = computed(() => data.value?.total ?? 0);

/** 首页「新建联系人」带 ?create=1 过来，落地即开弹窗；参数随即抹掉，刷新不会反复弹。 */
onMounted(() => {
	if (route.query.create !== "1") return;

	showCreate.value = true;

	const next = { ...route.query };
	delete next.create;
	void router.replace({ query: next });
});
</script>

<template>
	<div class="cvd crm-page">
		<PageHead title="联系人">
			<template #chips>
				<span class="cvd-chip">共 {{ total }} 位</span>
				<span v-if="archived" class="cvd-chip cvd-chip--plain">含已归档</span>
			</template>
			<template #meta>
				<span>按姓名、邮箱、微信号搜索</span>
				<span class="cvd-sep">·</span>
				<span>点姓名进关系卡，邮箱与电话默认脱敏</span>
			</template>
			<template #actions>
				<button class="cvd-btn cvd-btn--primary" @click="showCreate = true">新建联系人</button>
			</template>
		</PageHead>

		<section class="cvd-card cvd-card--table">
			<div class="cvd-toolbar">
				<div class="cvd-toolbar__group">
					<el-input
						v-model="q"
						placeholder="搜索姓名 / 邮箱 / 微信号"
						style="width: 258px"
						clearable
						@keyup.enter="search"
						@clear="search"
					>
						<template #prefix>
							<svg class="cvd-ico cvd-toolbar__ico" viewBox="0 0 24 24">
								<circle cx="11" cy="11" r="6.6" /><path d="M16 16.4 20.5 21" />
							</svg>
						</template>
					</el-input>
					<el-select
						v-model="relationship"
						clearable
						placeholder="关系维护：全部"
						style="width: 168px"
						@change="search"
					>
						<el-option label="默认" :value="RELATIONSHIP_BLANK" />
						<el-option
							v-for="option in relationshipOptions"
							:key="option"
							:label="option"
							:value="option"
						/>
					</el-select>
					<button class="cvd-btn" @click="search">搜索</button>
				</div>
				<div class="cvd-toolbar__group cvd-toolbar__group--end">
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

			<template v-if="total > 0">
				<RecordTable :columns="visibleColumns" :rows="data?.items ?? []">
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

				<el-pagination
					v-if="total > 20"
					class="cvd-pagination"
					layout="prev, pager, next"
					:total="total"
					:page-size="20"
					:current-page="page"
					@current-change="(value: number) => (page = value)"
				/>
			</template>

			<el-empty
				v-else
				:image-size="66"
				:description="archived ? '没有已归档的联系人' : '还没有联系人，先建一个'"
			/>
		</section>

		<el-dialog v-model="showCreate" title="新建联系人" width="520">
			<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
			<ContactForm :submitting="submitting" @submit="createContact" @cancel="showCreate = false" />
		</el-dialog>
	</div>
</template>
