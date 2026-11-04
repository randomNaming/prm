<script setup lang="ts">
/** 选择器只关心这三样，避免把 ListColumn<T> 的泛型传染进来。 */
type PickerColumn = {
	key: string;
	label: string;
	custom?: boolean;
};

const props = defineProps<{
	columns: PickerColumn[];
	modelValue: string[];
}>();

const emit = defineEmits<{
	"update:modelValue": [keys: string[]];
	reset: [];
}>();

const builtin = computed(() => props.columns.filter((column) => !column.custom));
const custom = computed(() => props.columns.filter((column) => column.custom));

function onChange(keys: unknown) {
	emit("update:modelValue", Array.isArray(keys) ? (keys as string[]) : []);
}
</script>

<template>
	<el-popover :width="280" trigger="click" placement="bottom-end">
		<template #reference>
			<button class="cvd-btn cvd-btn--sm crm-colpick__trigger">
				显示字段
				<span class="crm-colpick__count">{{ modelValue.length }}/{{ columns.length }}</span>
			</button>
		</template>

		<div class="crm-colpick__head">
			<strong>列表显示哪些字段</strong>
			<el-button link type="primary" size="small" @click="emit('reset')">恢复默认</el-button>
		</div>

		<div class="crm-colpick__body">
			<el-checkbox-group :model-value="modelValue" @change="onChange">
				<el-checkbox v-for="column in builtin" :key="column.key" :value="column.key" :label="column.label" />
			</el-checkbox-group>

			<template v-if="custom.length">
				<div class="crm-colpick__divider">自定义字段</div>
				<el-checkbox-group :model-value="modelValue" @change="onChange">
					<el-checkbox v-for="column in custom" :key="column.key" :value="column.key" :label="column.label" />
				</el-checkbox-group>
			</template>
		</div>

		<div class="crm-colpick__hint crm-muted">选择会记在这台浏览器上，下次打开照旧。</div>
	</el-popover>
</template>

<style scoped>
.crm-colpick__trigger {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
}

.crm-colpick__count {
	color: var(--crm-faint);
	font-size: 11px;
	font-variant-numeric: tabular-nums;
}

.crm-colpick__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 8px;
	font-size: 12.5px;
	color: var(--crm-ink);
}

.crm-colpick__body {
	max-height: 320px;
	overflow-y: auto;
}

.crm-colpick__body :deep(.el-checkbox-group) {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.crm-colpick__body :deep(.el-checkbox) {
	height: 26px;
	font-size: 12.5px;
}

.crm-colpick__divider {
	margin: 10px 0 6px;
	padding-top: 8px;
	border-top: 1px dashed var(--crm-line);
	font-size: 11.5px;
	color: var(--crm-faint);
}

.crm-colpick__hint {
	margin-top: 10px;
	font-size: 11.5px;
	line-height: 1.6;
}
</style>
