<script setup lang="ts">
import { ACTIVITY_KIND_LABELS } from "~/types/domain";
import type { ActivityKind } from "~/types/domain";

const api = useApi();
const router = useRouter();

const { data } = await useAsyncData("dashboard", () => api.dashboard());

/** 看板与 EisenhowerBoard 共用同一个 key，SSR 只取一次。 */
const { data: board } = await useAsyncData("board", () => api.board());

/** 三个总数只取 1 条明细，够拿到 total，别把首页拖成列表页。 */
const { data: counts } = await useAsyncData("home-counts", async () => {
	const [contacts, companies, deals] = await Promise.all([
		api.listContacts({ pageSize: 1 }),
		api.listCompanies({ pageSize: 1 }),
		api.listDeals({ pageSize: 1 }),
	]);

	return {
		contacts: contacts.total,
		companies: companies.total,
		deals: deals.total,
	};
});

const greeting = computed(() => {
	const hour = new Date().getHours();
	if (hour < 6) return "夜深了";
	if (hour < 12) return "早上好";
	if (hour < 18) return "下午好";

	return "晚上好";
});

const todayLabel = computed(() => {
	const now = new Date();
	const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

	return `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()]}`;
});

const tasks = computed(() => data.value?.tasks ?? []);

const boardCount = computed(() =>
	(board.value?.columns ?? []).reduce((sum, column) => sum + column.items.length, 0),
);

const activities = computed(() => data.value?.activities ?? []);

/** 活动按种类配图标，和详情页「沟通与互动」保持同一套视觉。 */
const ACTIVITY_ICONS: Record<ActivityKind, string[]> = {
	task: ["M4 12.5 9 17.5 20 6.5"],
	note: ["M4 6h16M4 12h16M4 18h10"],
	chat_log: ["M4 5h16v14H4z", "M8 9h8M8 13h5"],
	email: ["M3 6h18v12H3z", "M3 7l9 6 9-6"],
	stage_change: ["M4 12h11", "M12 6l6 6-6 6"],
};

function openCreate(path: string) {
	void router.push({ path, query: { create: "1" } });
}
</script>

<template>
	<div class="cvd crm-page">
		<PageHead :title="greeting">
			<template #chips>
				<span v-if="tasks.length" class="cvd-chip">{{ tasks.length }} 项待办</span>
			</template>
			<template #meta>
				<span>{{ todayLabel }}</span>
				<span class="cvd-sep">·</span>
				<span>在册 {{ counts?.contacts ?? 0 }} 位联系人</span>
				<span class="cvd-sep">·</span>
				<span>看板 {{ boardCount }} 项待判</span>
				<template v-if="board?.pinnedCount">
					<span class="cvd-sep">·</span>
					<span>{{ board.pinnedCount }} 项手动摆放</span>
				</template>
			</template>
			<template #actions>
				<button class="cvd-btn cvd-btn--primary" @click="openCreate('/contacts')">新建联系人</button>
				<button class="cvd-btn" @click="openCreate('/deals')">新建商机</button>
				<button class="cvd-btn" @click="router.push('/chat')">问智能体</button>
			</template>
		</PageHead>

		<div class="cvd-stats">
			<NuxtLink to="/contacts" class="cvd-stat">
				<span class="cvd-stat__label">
					<svg class="cvd-ico" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4S18.3 16.4 19.5 20" /></svg>
					联系人
				</span>
				<span class="cvd-stat__num">{{ counts?.contacts ?? "—" }}<span class="cvd-stat__unit">位</span></span>
				<span class="cvd-stat__hint">每人都有一张关系卡</span>
			</NuxtLink>

			<NuxtLink to="/companies" class="cvd-stat">
				<span class="cvd-stat__label">
					<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 21V7l8-4 8 4v14" /><path d="M9 21v-5h6v5" /><path d="M9 10h.01M15 10h.01" /></svg>
					公司
				</span>
				<span class="cvd-stat__num">{{ counts?.companies ?? "—" }}<span class="cvd-stat__unit">家</span></span>
				<span class="cvd-stat__hint">正在合作与待开发</span>
			</NuxtLink>

			<NuxtLink to="/deals" class="cvd-stat">
				<span class="cvd-stat__label">
					<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 7h16v12H4z" /><path d="M8 7V5h8v2" /><path d="M8 13h8" /></svg>
					商机
				</span>
				<span class="cvd-stat__num">{{ counts?.deals ?? "—" }}<span class="cvd-stat__unit">个</span></span>
				<span class="cvd-stat__hint">成交漏斗里的机会</span>
			</NuxtLink>

			<div class="cvd-stat">
				<span class="cvd-stat__label">
					<svg class="cvd-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="M12 8v4.2l2.6 1.8" /></svg>
					逾期任务
				</span>
				<span class="cvd-stat__num" :class="{ 'cvd-stat__num--risk': tasks.length > 0 }">
					{{ tasks.length }}<span class="cvd-stat__unit">项</span>
				</span>
				<span class="cvd-stat__hint">{{ tasks.length ? "先在右上角看板里处理" : "今天没有欠账" }}</span>
			</div>
		</div>

		<section class="cvd-card cvd-card--section">
			<div class="cvd-card__head">
				<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z" /></svg>
				<span class="cvd-card__title">今日轻重缓急</span>
				<span class="cvd-card__meta">拖动卡片即可改判 · 共 {{ boardCount }} 项</span>
			</div>
			<EisenhowerBoard />
		</section>

		<section class="cvd-card">
			<div class="cvd-card__head">
				<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" /></svg>
				<span class="cvd-card__title">近期活动</span>
				<span class="cvd-card__meta">最近 {{ activities.length }} 条</span>
			</div>

			<ul v-if="activities.length" class="cvd-tl">
				<li v-for="activity in activities" :key="activity.id">
					<span class="cvd-tl__ico">
						<svg class="cvd-ico" viewBox="0 0 24 24">
							<path v-for="(d, index) in ACTIVITY_ICONS[activity.kind] ?? ACTIVITY_ICONS.note" :key="index" :d="d" />
						</svg>
					</span>
					<div class="cvd-tl__body">
						<div class="cvd-tl__title">{{ activity.title }}</div>
						<div class="cvd-tl__time">
							{{ formatRelative(activity.createdAt) }}
							<template v-if="activity.contactName"> · {{ activity.contactName }}</template>
						</div>
					</div>
					<div class="cvd-tl__meta">
						<span class="cvd-pill cvd-pill--plan">{{ ACTIVITY_KIND_LABELS[activity.kind] }}</span>
						<NuxtLink
							v-if="activity.contactId"
							:to="`/contacts/${activity.contactId}`"
							class="cvd-tl__link"
						>查看</NuxtLink>
					</div>
				</li>
			</ul>
			<div v-else class="cvd-muted cvd-card__empty">还没有活动记录，导入一段聊天或记一条活动就会出现在这里。</div>
		</section>
	</div>
</template>

<style scoped>
.cvd-stat__num--risk {
	color: #a2594f;
}

/*
 * 看板自己带卡片头，这里把它的四象限直接铺在首页卡片里，
 * 底部提示与卡片内边距对齐，不留第二层边框。
 */
:deep(.crm-board) {
	margin-top: 2px;
}

.cvd-tl__meta {
	display: flex;
	align-items: center;
	gap: 10px;
	flex: none;
	align-self: center;
}

.cvd-tl__link {
	font-size: 11.5px;
	color: var(--brand);
	text-decoration: none;
	font-weight: 600;
	white-space: nowrap;
}

.cvd-tl__link:hover {
	text-decoration: underline;
	text-underline-offset: 3px;
}

.cvd-card__empty {
	padding: 14px 2px 4px;
}
</style>
