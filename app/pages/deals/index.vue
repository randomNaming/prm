<script setup lang="ts">
import { DEAL_STAGES, DEAL_STATUS_LABELS, type Deal, type DealStatus } from "~/types/domain";

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

/** 状态只用三种语气：推进中=蓝、成交=绿、搁置=灰。 */
function statusTone(status: DealStatus): string {
	if (status === "won") return "cvd-pill cvd-pill--ok";
	if (status === "shelved") return "cvd-pill cvd-pill--done";

	return "cvd-pill cvd-pill--plan";
}

/** 首页「新建商机」带 ?create=1 过来，落地即开弹窗，参数随即抹掉。 */
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
		<PageHead title="商机">
			<template #chips>
				<span class="cvd-chip">共 {{ total }} 个</span>
			</template>
			<template #meta>
				<span>按商机名称搜索</span>
				<span class="cvd-sep">·</span>
				<span>阶段停留越久，越该推一下或关掉</span>
			</template>
			<template #actions>
				<button class="cvd-btn cvd-btn--primary" @click="showCreate = true">新建商机</button>
			</template>
		</PageHead>

		<section class="cvd-card cvd-card--table">
			<div class="cvd-toolbar">
				<div class="cvd-toolbar__group">
					<el-input
						v-model="q"
						placeholder="搜索商机名称"
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
					<el-select v-model="stage" clearable placeholder="全部阶段" style="width: 152px" @change="search">
						<el-option v-for="item in DEAL_STAGES" :key="item" :label="item" :value="item" />
					</el-select>
					<button class="cvd-btn" @click="search">搜索</button>
				</div>
				<div class="cvd-toolbar__group cvd-toolbar__group--end">
					<span class="cvd-toolbar__label">阶段一变，停留天数重新计时</span>
				</div>
			</div>

			<el-table v-if="total > 0" :data="data?.items ?? []" style="width: 100%">
				<el-table-column label="商机" min-width="200">
					<template #default="{ row }">
						<NuxtLink :to="`/deals/${row.id}`" class="cvd-link">{{ row.name }}</NuxtLink>
					</template>
				</el-table-column>
				<el-table-column label="阶段" min-width="110">
					<template #default="{ row }">
						<span class="cvd-tag">{{ row.stage }}</span>
					</template>
				</el-table-column>
				<el-table-column label="状态" min-width="100">
					<template #default="{ row }">
						<span :class="statusTone((row as Deal).status)">{{ DEAL_STATUS_LABELS[(row as Deal).status] }}</span>
					</template>
				</el-table-column>
				<el-table-column label="停留" min-width="120">
					<template #default="{ row }">{{ stageDuration(row.stageChangedAt) }}</template>
				</el-table-column>
				<el-table-column prop="expectedCloseDate" label="预计成交" min-width="120">
					<template #default="{ row }">
						<span v-if="row.expectedCloseDate">{{ row.expectedCloseDate }}</span>
						<span v-else class="cvd-muted">—</span>
					</template>
				</el-table-column>
			</el-table>

			<template v-if="total > 20">
				<el-pagination
					class="cvd-pagination"
					layout="prev, pager, next"
					:total="total"
					:page-size="20"
					:current-page="page"
					@current-change="(value: number) => (page = value)"
				/>
			</template>

			<el-empty v-if="total === 0" :image-size="66" description="还没有商机，先建一个" />
		</section>

		<el-dialog v-model="showCreate" title="新建商机" width="520">
			<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
			<DealForm :submitting="submitting" @submit="createDeal" @cancel="showCreate = false" />
		</el-dialog>
	</div>
</template>
