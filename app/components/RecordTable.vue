<script setup lang="ts" generic="T extends { id: string }">
import { Check, CopyDocument, Hide, View } from "@element-plus/icons-vue";
import type { ListColumn } from "~/utils/list-columns";
import { copyText } from "~/utils/clipboard";

const props = defineProps<{
	columns: ListColumn<T>[];
	rows: T[];
}>();

/**
 * 敏感列（电话、邮箱）默认脱敏。
 *
 * 状态刻意只放在会话内存里：每次进列表都重新默认脱敏，眼睛开关管整列，
 * 行值右侧的眼睛管单格（临时显示 5 秒后自动掩回去），复制始终复制完整值。
 */
const maskedOff = ref<Record<string, boolean>>({});
const revealed = ref<Record<string, boolean>>({});
const copiedCell = ref("");

const revealTimers = new Map<string, ReturnType<typeof setTimeout>>();
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function isMasked(column: ListColumn<T>): boolean {
	return column.sensitive === true && maskedOff.value[column.key] !== true;
}

function cellKey(column: ListColumn<T>, row: T): string {
	return `${column.key}:${row.id}`;
}

function isRevealed(column: ListColumn<T>, row: T): boolean {
	return revealed.value[cellKey(column, row)] === true;
}

function toggleReveal(column: ListColumn<T>, row: T) {
	const key = cellKey(column, row);

	if (!isMasked(column)) return;

	const existing = revealTimers.get(key);
	if (existing) clearTimeout(existing);
	revealTimers.delete(key);

	// 再点一次立即掩回；否则临时显示 5 秒，够看清、不至于一直裸奔。
	if (revealed.value[key]) {
		revealed.value = { ...revealed.value, [key]: false };
		return;
	}

	revealed.value = { ...revealed.value, [key]: true };
	revealTimers.set(
		key,
		setTimeout(() => {
			revealed.value = { ...revealed.value, [key]: false };
			revealTimers.delete(key);
		}, 5000),
	);
}

/** 电话保头 3 尾 2，邮箱保本地部分头 2 和域名。 */
function maskedValue(column: ListColumn<T>, row: T): string {
	const value = column.value(row);

	if (column.key === "email") {
		const at = value.indexOf("@");
		if (at > 0) {
			const local = value.slice(0, at);
			return `${local.slice(0, 2)}***${value.slice(at)}`;
		}
	}

	return value.length > 6
		? `${value.slice(0, 3)}****${value.slice(-2)}`
		: `${value.slice(0, 1)}***`;
}

async function copyCellValue(column: ListColumn<T>, row: T) {
	if (!(await copyText(column.value(row)))) return;

	copiedCell.value = cellKey(column, row);
	if (copyTimer) clearTimeout(copyTimer);
	copyTimer = setTimeout(() => {
		copiedCell.value = "";
	}, 1500);
}
</script>

<template>
	<el-table :data="props.rows" style="width: 100%">
		<el-table-column
			v-for="column in props.columns"
			:key="column.key"
			:label="column.label"
			:min-width="column.minWidth"
			show-overflow-tooltip
		>
			<template v-if="column.sensitive" #header>
				<span class="crm-sensitive-head" :title="isMasked(column) ? '当前已脱敏，点击显示完整值' : '当前显示完整值，点击恢复脱敏'">
					{{ column.label }}
					<el-icon class="crm-sensitive-head__toggle" @click="maskedOff = { ...maskedOff, [column.key]: isMasked(column) }">
						<Hide v-if="isMasked(column)" />
						<View v-else />
					</el-icon>
				</span>
			</template>

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
				<span v-else-if="column.sensitive && column.value(row)" class="crm-sensitive-cell">
					<span>{{ isMasked(column) && !isRevealed(column, row) ? maskedValue(column, row) : column.value(row) }}</span>
					<el-icon
						v-if="isMasked(column)"
						class="crm-sensitive-cell__icon"
						:title="isRevealed(column, row) ? '隐藏' : '临时显示完整值'"
						@click="toggleReveal(column, row)"
					>
						<Hide v-if="isRevealed(column, row)" />
						<View v-else />
					</el-icon>
					<el-icon class="crm-sensitive-cell__icon" title="复制完整值" @click="copyCellValue(column, row)">
						<Check v-if="copiedCell === cellKey(column, row)" />
						<CopyDocument v-else />
					</el-icon>
				</span>
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

.crm-sensitive-head__toggle {
	margin-left: 4px;
	cursor: pointer;
	color: var(--crm-muted);
	vertical-align: -2px;
}

.crm-sensitive-head__toggle:hover {
	color: var(--crm-brand);
}

.crm-sensitive-cell {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.crm-sensitive-cell__icon {
	cursor: pointer;
	color: var(--crm-muted);
	flex: none;
}

.crm-sensitive-cell__icon:hover {
	color: var(--crm-brand);
}
</style>
