<script setup lang="ts" generic="T extends { id: string }">
import type { ListColumn } from "~/utils/list-columns";

defineProps<{
	columns: ListColumn<T>[];
	rows: T[];
}>();
</script>

<template>
	<el-table :data="rows" style="width: 100%">
		<el-table-column
			v-for="column in columns"
			:key="column.key"
			:label="column.label"
			:min-width="column.minWidth"
			show-overflow-tooltip
		>
			<template #default="{ row }">
				<NuxtLink
					v-if="column.kind === 'link' || (column.kind === 'company' && column.to?.(row))"
					:to="column.to?.(row) ?? ''"
					class="crm-link"
				>
					{{ column.value(row) }}
				</NuxtLink>
				<el-tag v-else-if="column.kind === 'tag' && column.value(row)" size="small" effect="plain">
					{{ column.value(row) }}
				</el-tag>
				<span v-else-if="column.value(row)">{{ column.value(row) }}</span>
				<span v-else class="crm-muted">—</span>
			</template>
		</el-table-column>

		<slot name="actions" />
	</el-table>
</template>

<style scoped>
.crm-link {
	color: var(--crm-brand);
	text-decoration: none;
	font-weight: 500;
}
</style>
