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
	<div class="cvd crm-board">
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
					<span class="crm-board__dot" />
					<strong class="crm-board__label">{{ column.label }}</strong>
					<span class="crm-board__count">{{ column.items.length }}</span>
				</header>

				<p v-if="column.items.length === 0" class="cvd-muted crm-board__empty">
					空。把别的格子里的东西拖进来即可。
				</p>

				<!-- 不重要不紧急：一片慢慢飘的词云，词条是「{姓名}{关系状态}」整句 -->
				<div v-else-if="column.quadrant === 'neither'" class="crm-board__cloud">
					<NuxtLink
						v-for="(item, index) in column.items"
						:key="`${item.type}-${item.id}`"
						:to="item.to"
						class="crm-cloud__word"
						:class="[
							`crm-cloud__word--${index % 4}`,
							{ 'is-pinned': item.pinned, 'is-busy': busy === `${item.type}:${item.id}` },
						]"
						:style="driftStyle(index)"
						:title="item.detail ?? item.title"
						draggable="false"
					>
						{{ item.title }}{{ item.badge ?? "" }}
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
							<div v-if="item.detail" class="crm-board__detail">{{ item.detail }}</div>
						</div>

						<div class="crm-board__meta">
							<span v-if="item.badge" class="crm-board__badge">{{ item.badge }}</span>
							<span v-if="item.pinned" class="crm-board__pin" title="被你手动拖过来的">手动</span>
							<button
								v-if="item.type === 'task'"
								class="crm-board__done"
								:disabled="busy === `${item.type}:${item.id}`"
								@click="completeTask(item)"
							>完成</button>
						</div>
					</article>
				</div>
			</section>
		</div>

		<p class="cvd-muted crm-board__foot">
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
	border: 1px solid var(--line);
	border-radius: 10px;
	padding: 11px 13px 9px;
	min-height: 138px;
	transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.crm-board__cell.is-over {
	border-color: var(--brand);
	box-shadow: 0 0 0 3px var(--brand-soft);
}

/* 四象限各用一个色点做身份，不靠整块底色喊话 */
.crm-board__cell--urgent_important {
	background: #fffafa;
	border-color: #f3e0dc;
}

.crm-board__cell--neither {
	background: #fbfcfd;
}

.crm-board__head {
	display: flex;
	align-items: center;
	gap: 7px;
	margin-bottom: 6px;
}

.crm-board__dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	flex: none;
	background: var(--brand);
}

.crm-board__cell--urgent_important .crm-board__dot {
	background: #c0644f;
}

.crm-board__cell--important .crm-board__dot {
	background: #4b7bd4;
}

.crm-board__cell--urgent .crm-board__dot {
	background: #d3a13f;
}

.crm-board__cell--neither .crm-board__dot {
	background: #b7c0cd;
}

.crm-board__label {
	font-size: 12.5px;
	font-weight: 650;
	color: var(--ink);
	letter-spacing: 0.2px;
}

.crm-board__count {
	margin-left: auto;
	font-size: 10.5px;
	font-weight: 600;
	line-height: 1.5;
	padding: 0 6px;
	border-radius: 999px;
	background: var(--grey-bg);
	color: #7b8494;
	font-variant-numeric: tabular-nums;
}

.crm-board__empty {
	font-size: 11.5px;
	margin: 0;
	line-height: 1.7;
}

.crm-board__list {
	display: flex;
	flex-direction: column;
}

/* 每条是一行，不再嵌套第二层小卡片 —— 与详情页的 kv / 时间线是同一节奏 */
.crm-board__card {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 7px 6px;
	margin: 0 -6px;
	border-bottom: 1px dashed var(--line-soft);
	border-radius: 7px;
	cursor: grab;
	transition: background 0.12s;
}

.crm-board__card:last-child {
	border-bottom: none;
}

.crm-board__card:hover {
	background: #f8fafd;
}

.crm-board__card:active {
	cursor: grabbing;
}

.crm-board__card.is-busy {
	opacity: 0.5;
}

.crm-board__rank {
	flex: none;
	width: 16px;
	height: 16px;
	line-height: 16px;
	text-align: center;
	border-radius: 50%;
	background: #d9534f;
	color: #fff;
	font-size: 10px;
	font-weight: 600;
	margin-top: 2px;
}

.crm-board__body {
	flex: 1;
	min-width: 0;
}

.crm-board__title {
	color: var(--ink);
	font-weight: 500;
	text-decoration: none;
	font-size: 12.5px;
	line-height: 1.5;
}

.crm-board__title:hover {
	color: var(--brand);
}

.crm-board__card--urgent .crm-board__title {
	color: #3f2b28;
}

.crm-board__detail {
	font-size: 11px;
	margin-top: 1px;
	color: var(--muted);
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
	gap: 5px;
}

.crm-board__badge {
	font-size: 10.5px;
	color: #a2594f;
	white-space: nowrap;
	font-weight: 600;
}

.crm-board__pin {
	font-size: 10px;
	color: var(--faint);
	border: 1px dashed #dfe4ec;
	border-radius: 4px;
	padding: 0 3px;
	line-height: 1.5;
}

.crm-board__done {
	border: none;
	background: none;
	padding: 0 2px;
	margin-left: 2px;
	font-family: inherit;
	font-size: 11px;
	font-weight: 600;
	color: var(--brand);
	cursor: pointer;
}

.crm-board__done:hover {
	text-decoration: underline;
	text-underline-offset: 3px;
}

.crm-board__done:disabled {
	opacity: 0.5;
	cursor: default;
	text-decoration: none;
}

.crm-board__cloud {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	column-gap: 18px;
	row-gap: 8px;
	padding: 4px 0 2px;
	line-height: 2;
}

/* 第四象限：一片慢慢飘的词云。没有边框和底色，大小深浅错开。
   hover 暂停，否则想点的时候它一直在跑。 */
.crm-cloud__word {
	color: var(--muted);
	text-decoration: none;
	white-space: nowrap;
	animation-name: crm-drift;
	animation-timing-function: ease-in-out;
	animation-iteration-count: infinite;
	will-change: transform;
}

.crm-cloud__word:hover {
	animation-play-state: paused;
	color: var(--brand);
	text-decoration: underline;
	text-underline-offset: 5px;
}

/* 手动拖进来的：虚线下划线做记号，和词云里自动判进来区分开。 */
.crm-cloud__word.is-pinned {
	text-decoration: underline dashed;
	text-underline-offset: 5px;
}

.crm-cloud__word.is-busy {
	opacity: 0.5;
}

.crm-cloud__word--0 {
	font-size: 15px;
	font-weight: 600;
	color: #5b6472;
}

.crm-cloud__word--1 {
	font-size: 12px;
}

.crm-cloud__word--2 {
	font-size: 13.5px;
	font-weight: 500;
}

.crm-cloud__word--3 {
	font-size: 12.5px;
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
	.crm-cloud__word {
		animation: none;
	}
}

.crm-board__foot {
	font-size: 11.5px;
	margin: 10px 0 0;
	line-height: 1.7;
}

@media (max-width: 720px) {
	.crm-board__grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
