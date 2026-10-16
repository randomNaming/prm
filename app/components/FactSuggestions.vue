<script setup lang="ts">
import { FACT_FIELD_LABELS, FACT_STATUS_LABELS } from "~/types/domain";

type SuggestionFact = {
	id: string;
	field: string;
	value: string;
	status: string;
	evidence: { kind: string; quote: string; ref: string | null; time: string | null }[];
	source: string;
};

const props = withDefaults(
	defineProps<{
		facts: SuggestionFact[];
		busy?: boolean;
		labels?: Record<string, string>;
	}>(),
	{ labels: () => FACT_FIELD_LABELS },
);

const emit = defineEmits<{
	decide: [payload: { id: string; action: "accept" | "reject" | "revert" }];
}>();

const proposed = computed(() => props.facts.filter((fact) => fact.status === "proposed"));
const decided = computed(() => props.facts.filter((fact) => fact.status !== "proposed"));

function labelOf(field: string): string {
	return props.labels[field] ?? field;
}

function statusLabel(status: string): string {
	return FACT_STATUS_LABELS[status as keyof typeof FACT_STATUS_LABELS] ?? status;
}
</script>

<template>
	<div>
		<el-empty v-if="proposed.length === 0" description="没有待确认的字段建议" :image-size="72" />

		<div v-for="fact in proposed" :key="fact.id" class="crm-card crm-suggestion">
			<div class="crm-spread">
				<div>
					<strong>{{ labelOf(fact.field) }}</strong>
					<span class="crm-muted"> → </span>
					<span>{{ fact.value }}</span>
				</div>
				<div class="crm-row">
					<el-button size="small" type="primary" :disabled="busy" @click="emit('decide', { id: fact.id, action: 'accept' })">
						接受
					</el-button>
					<el-button size="small" :disabled="busy" @click="emit('decide', { id: fact.id, action: 'reject' })">
						拒绝
					</el-button>
				</div>
			</div>
			<div class="crm-muted crm-suggestion__source">来源：{{ fact.source }}</div>
			<div v-for="(item, index) in fact.evidence" :key="index" class="crm-quote">
				{{ item.kind }}<span v-if="item.ref">（{{ item.ref }}）</span><span v-if="item.time">（{{ item.time }}）</span>：{{ item.quote }}
			</div>
		</div>

		<el-collapse v-if="decided.length > 0" class="crm-suggestion__history">
			<el-collapse-item :title="`已处理的字段事实（${decided.length}）`">
				<div v-for="fact in decided" :key="fact.id" class="crm-timeline-item">
					<div class="crm-spread">
						<span>{{ labelOf(fact.field) }} → {{ fact.value }}</span>
						<div class="crm-row">
							<el-tag size="small" type="info" effect="plain">
								{{ statusLabel(fact.status) }}
							</el-tag>
							<!-- 接受点错了要能反悔：已写入的值可以撤销（有列的字段列值不动，改值用「编辑」）。 -->
							<el-popconfirm
								v-if="fact.status === 'applied'"
								title="撤销这条已写入的值？"
								@confirm="emit('decide', { id: fact.id, action: 'revert' })"
							>
								<template #reference>
									<el-button size="small" link type="danger" :disabled="busy">撤销</el-button>
								</template>
							</el-popconfirm>
						</div>
					</div>
					<div v-for="(item, index) in fact.evidence" :key="index" class="crm-quote">
						{{ item.kind }}<span v-if="item.ref">（{{ item.ref }}）</span><span v-if="item.time">（{{ item.time }}）</span>：{{ item.quote }}
					</div>
				</div>
			</el-collapse-item>
		</el-collapse>
	</div>
</template>

<style scoped>
.crm-suggestion {
	margin-bottom: 12px;
}

.crm-suggestion__source {
	font-size: 12px;
	margin: 6px 0;
}

.crm-suggestion__history {
	margin-top: 12px;
}
</style>
