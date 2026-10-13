<script setup lang="ts">
import { FIELD_SCOPE_LABELS, type FieldDef } from "~/types/domain";

const props = defineProps<{
	fields: FieldDef[];
	busy?: boolean;
}>();

const emit = defineEmits<{
	decide: [payload: { id: string; action: "accept" | "reject" }];
}>();

const proposed = computed(() => props.fields.filter((field) => field.status === "proposed"));
</script>

<template>
	<div v-if="proposed.length > 0">
		<h2 class="crm-section__title">新字段建议</h2>
		<div v-for="field in proposed" :key="field.id" class="crm-card crm-field-proposal">
			<div class="crm-spread">
				<div>
					<strong>{{ field.label }}</strong>
					<span class="crm-muted"> · {{ FIELD_SCOPE_LABELS[field.scope] }}字段</span>
					<span v-if="field.sampleValue" class="crm-muted"> · 示例值：{{ field.sampleValue }}</span>
				</div>
				<div class="crm-row">
					<el-button
						size="small"
						type="primary"
						:disabled="busy"
						@click="emit('decide', { id: field.id, action: 'accept' })"
					>
						接受
					</el-button>
					<el-button
						size="small"
						:disabled="busy"
						@click="emit('decide', { id: field.id, action: 'reject' })"
					>
						拒绝
					</el-button>
				</div>
			</div>
			<div v-for="(item, index) in field.evidence ?? []" :key="index" class="crm-quote">
				{{ item.kind }}<span v-if="item.ref">（{{ item.ref }}）</span>：{{ item.quote }}
			</div>
		</div>
	</div>
</template>

<style scoped>
.crm-field-proposal {
	margin-bottom: 12px;
}
</style>
