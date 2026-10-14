<script setup lang="ts">
import type { BoardItem, BoardQuadrant } from "~/types/domain";

const api = useApi();

const { data, refresh } = await useAsyncData("board", () => api.board());

const columns = computed(() => data.value?.columns ?? []);
const dragging = ref<BoardItem | null>(null);
const overQuadrant = ref<BoardQuadrant | "">("");
const busy = ref("");
const errorText = ref("");

function keyOf(item: BoardItem): string {
	return `${item.type}:${item.id}`;
}

function onDragStart(item: BoardItem, event: DragEvent) {
	dragging.value = item;
	overQuadrant.value = "";

	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", keyOf(item));
	}
}

function onDragEnd() {
	dragging.value = null;
	overQuadrant.value = "";
}

async function onDrop(quadrant: BoardQuadrant) {
	const item = dragging.value;

	overQuadrant.value = "";
	dragging.value = null;

	if (!item || item.quadrant === quadrant) return;

	busy.value = keyOf(item);
	errorText.value = "";

	try {
		// 把推断值一起回传：拖回它本来该在的象限，服务端会删掉覆盖，等于恢复自动。
		await api.pinBoardItem({
			type: item.type,
			id: item.id,
			quadrant,
			inferred: item.inferred,
		});
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "移动失败。";
	} finally {
		busy.value = "";
	}
}

async function completeTask(item: BoardItem) {
	busy.value = keyOf(item);

	try {
		await api.decideActivity(item.id, "complete");
		await refresh();
	} finally {
		busy.value = "";
	}
}

/** 飘动要慢，而且要错开，否则一整片同步晃动像坏了。 */
function driftStyle(index: number) {
	return {
		animationDelay: `${(index % 6) * 0.9}s`,
		animationDuration: `${9 + (index % 4) * 1.5}s`,
	};
}
</script>

<template>
	<div class="crm-board">
		<el-alert v-if="errorText" class="crm-board__error" type="error" :closable="false" show-icon :title="errorText" />

		<div class="crm-board__grid">
			<section
				v-for="column in columns"
				:key="column.quadrant"
				class="crm-board__cell"
				:class="[
					`crm-board__cell--${column.quadrant}`,
					{ 'is-over': overQuadrant === column.quadrant },
				]"
				@dragover.prevent="overQuadrant = column.quadrant"
				@dragleave="overQuadrant === column.quadrant && (overQuadrant = '')"
				@drop.prevent="onDrop(column.quadrant)"
			>
				<header class="crm-board__head">
					<strong class="crm-board__label">{{ column.label }}</strong>
					<span class="crm-muted crm-board__hint">{{ column.hint }}</span>
					<el-tag size="small" effect="plain" round>{{ column.items.length }}</el-tag>
				</header>

				<p v-if="column.items.length === 0" class="crm-muted crm-board__empty">
					空。把别的格子里的东西拖进来即可。
				</p>

				<!-- 不重要不紧急：只当标签，慢慢地飘 -->
				<div v-else-if="column.quadrant === 'neither'" class="crm-board__chips">
					<NuxtLink
						v-for="(item, index) in column.items"
						:key="`${item.type}-${item.id}`"
						:to="item.to"
						class="crm-chip"
						:class="{ 'is-pinned': item.pinned, 'is-busy': busy === `${item.type}:${item.id}` }"
						:style="driftStyle(index)"
						:title="item.detail ?? item.title"
						draggable="false"
					>
						{{ item.title }}
						<span v-if="item.badge" class="crm-chip__badge">{{ item.badge }}</span>
					</NuxtLink>
				</div>

				<div v-else class="crm-board__list">
					<article
						v-for="(item, index) in column.items"
						:key="`${item.type}-${item.id}`"
						class="crm-board__card"
						:class="{
							'crm-board__card--urgent': column.quadrant === 'urgent_important',
							'is-pinned': item.pinned,
							'is-busy': busy === `${item.type}:${item.id}`,
						}"
						draggable="true"
						@dragstart="onDragStart(item, $event)"
						@dragend="onDragEnd"
					>
						<span
							v-if="column.quadrant === 'urgent_important'"
							class="crm-board__rank"
						>{{ index + 1 }}</span>

						<div class="crm-board__body">
							<NuxtLink :to="item.to" class="crm-board__title" draggable="false">
								{{ item.title }}
							</NuxtLink>
							<div v-if="item.detail" class="crm-muted crm-board__detail">{{ item.detail }}</div>
						</div>

						<div class="crm-board__meta">
							<span v-if="item.badge" class="crm-board__badge">{{ item.badge }}</span>
							<span v-if="item.pinned" class="crm-muted crm-board__pin" title="被你手动拖过来的">手动</span>
							<el-button
								v-if="item.type === 'task'"
								link
								type="primary"
								size="small"
								:loading="busy === `${item.type}:${item.id}`"
								@click="completeTask(item)"
							>
								完成
							</el-button>
						</div>
					</article>
				</div>
			</section>
		</div>

		<p class="crm-muted crm-board__foot">
			把卡片拖到别的格子就能改判，判断记在库里；拖回它本来该在的位置即恢复自动判定。
			<span v-if="(data?.pinnedCount ?? 0) > 0">当前有 {{ data?.pinnedCount }} 项是你手动摆的。</span>
		</p>
	</div>
</template>

<style scoped>
.crm-board__error {
	margin-bottom: 12px;
}

.crm-board__grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12px;
}

.crm-board__cell {
	background: #fff;
	border: 1px solid var(--crm-line);
	border-radius: 8px;
	padding: 12px;
	min-height: 150px;
	transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.crm-board__cell.is-over {
	border-color: var(--crm-brand);
	box-shadow: 0 0 0 2px rgba(0, 107, 79, 0.12);
}

/* 第一象限：一眼要看到「这个现在就得动」 */
.crm-board__cell--urgent_important {
	border-color: #f0b4b4;
	background: #fffafa;
}

.crm-board__cell--neither {
	background: var(--crm-surface);
}

.crm-board__head {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 10px;
}

.crm-board__label {
	font-size: 14px;
}

.crm-board__hint {
	font-size: 12px;
	flex: 1;
}

.crm-board__empty {
	font-size: 12px;
	margin: 0;
}

.crm-board__list {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.crm-board__card {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 7px 9px;
	border: 1px solid var(--crm-line);
	border-radius: 6px;
	background: #fff;
	cursor: grab;
}

.crm-board__card:active {
	cursor: grabbing;
}

.crm-board__card.is-busy {
	opacity: 0.5;
}

/* 紧急且重要：整行标红，按顺序编号 */
.crm-board__card--urgent {
	border-color: #e88b8b;
	background: #fef2f2;
}

.crm-board__rank {
	flex: none;
	width: 18px;
	height: 18px;
	line-height: 18px;
	text-align: center;
	border-radius: 50%;
	background: #d94a4a;
	color: #fff;
	font-size: 11px;
	margin-top: 1px;
}

.crm-board__body {
	flex: 1;
	min-width: 0;
}

.crm-board__title {
	color: var(--crm-ink);
	font-weight: 500;
	text-decoration: none;
	font-size: 13px;
}

.crm-board__card--urgent .crm-board__title {
	color: #b3261e;
}

.crm-board__detail {
	font-size: 12px;
	margin-top: 2px;
	overflow: hidden;
	text-overflow: ellipsis;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
}

.crm-board__meta {
	flex: none;
	display: flex;
	align-items: center;
	gap: 4px;
}

.crm-board__badge {
	font-size: 11px;
	color: #b3261e;
	white-space: nowrap;
}

.crm-board__pin {
	font-size: 11px;
	border: 1px dashed var(--crm-line);
	border-radius: 3px;
	padding: 0 3px;
}

.crm-board__chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

/* 第四象限：不紧不慢地飘。hover 暂停，否则想点的时候它一直在跑。 */
.crm-chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 3px 9px;
	border-radius: 999px;
	border: 1px solid var(--crm-line);
	background: #fff;
	color: var(--crm-muted);
	font-size: 12px;
	text-decoration: none;
	animation-name: crm-drift;
	animation-timing-function: ease-in-out;
	animation-iteration-count: infinite;
	will-change: transform;
}

.crm-chip:hover {
	animation-play-state: paused;
	border-color: var(--crm-brand);
	color: var(--crm-brand);
}

.crm-chip.is-pinned {
	border-style: dashed;
}

.crm-chip.is-busy {
	opacity: 0.5;
}

.crm-chip__badge {
	color: #b3261e;
	font-size: 11px;
}

@keyframes crm-drift {
	0%,
	100% {
		transform: translate3d(0, 0, 0) rotate(0deg);
	}
	25% {
		transform: translate3d(2px, -3px, 0) rotate(-0.5deg);
	}
	50% {
		transform: translate3d(-2px, -1px, 0) rotate(0.4deg);
	}
	75% {
		transform: translate3d(1px, 2px, 0) rotate(-0.3deg);
	}
}

@media (prefers-reduced-motion: reduce) {
	.crm-chip {
		animation: none;
	}
}

.crm-board__foot {
	font-size: 12px;
	margin: 10px 0 0;
}

@media (max-width: 720px) {
	.crm-board__grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
