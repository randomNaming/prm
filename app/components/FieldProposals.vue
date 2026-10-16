<script setup lang="ts">
import { FIELD_SCOPE_LABELS, type FieldDef } from "~/types/domain";

const props = defineProps<{
	fields: FieldDef[];
	busy?: boolean;
	/**
	 * 新字段建议归属到它被提出时所在的记录（agent 调 propose_field 时的 subject），
	 * 只在那条记录的详情页展示，不再满屏都是。
	 * 没记来源的旧数据兜底显示，避免丢失无处审。
	 */
	recordId?: string;
}>();

const emit = defineEmits<{
	decide: [payload: { id: string; action: "accept" | "reject" }];
}>();

const proposed = computed(() =>
	props.fields.filter(
		(field) =>
			field.status === "proposed" &&
			(!props.recordId || !field.sampleRef || field.sampleRef === props.recordId),
	),
);
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
				{{ item.kind }}<span v-if="item.ref">（{{ item.ref }}）</span><span v-if="item.time">（{{ item.time }}）</span>：{{ item.quote }}
			</div>
		</div>
	</div>
</template>

<style scoped>
.crm-field-proposal {
	margin-bottom: 12px;
}
</style>
