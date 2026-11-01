<script setup lang="ts">
import type { AgentTask, ContactDetail, QueueStatus } from "~/types/domain";

const api = useApi();
const route = useRoute();

const { data: status, refresh } = await useAsyncData<QueueStatus | null>("queue-status", () =>
	api.status().catch(() => null),
);

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
	timer = setInterval(() => {
		void refresh();
	}, 15000);
});

onBeforeUnmount(() => {
	if (timer) clearInterval(timer);
});

const queueCount = computed(() =>
	status.value ? status.value.pending + status.value.running : 0,
);

/** 已排期但未到期的任务（未来的复查预约）：单独展示，不算「进行中」。 */
const scheduledCount = computed(() => status.value?.scheduled ?? 0);

const scheduledTasks = computed(() =>
	(status.value?.tasks ?? []).filter(
		(task) => task.status === "pending" && task.runAt > Date.now(),
	),
);

// ===== 顶栏队列管理弹层 =====

const activeTasks = computed(() =>
	(status.value?.tasks ?? []).filter((task) => task.status === "pending" || task.status === "running"),
);

const KIND_LABELS: Record<string, string> = {
	research_contact: "研究联系人",
	research_company: "研究公司",
	recheck: "到期复查",
};

function taskStatusText(task: AgentTask): string {
	// 未到期的排期任务单独说明执行时间，避免被误读成「卡住了」。
	if (task.status === "pending" && task.runAt > Date.now()) {
		return `已安排 · ${new Date(task.runAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 执行`;
	}

	const labels: Record<string, string> = {
		pending: "排队中",
		running: "执行中",
	};

	return labels[task.status] ?? task.status;
}

function taskTitle(task: AgentTask): string {
	const kind = KIND_LABELS[task.kind] ?? task.kind;
	return task.targetName ? `${kind}：${task.targetName}` : kind;
}

function formatTaskTime(at: number): string {
	return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

const terminating = ref("");

async function terminateTask(task: AgentTask) {
	if (!task.targetType || !task.targetId) return;

	terminating.value = task.id;

	try {
		await api.cancelResearch(task.targetType as "contact" | "company", task.targetId);
		await refresh();
	} finally {
		terminating.value = "";
	}
}

// ===== 侧栏导航 =====

const ICONS = {
	home: ["M3 10.5 12 3l9 7.5V21H3z", "M9 21v-7h6v7"],
	contact: ["M12 11.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2", "M4.5 20c1.2-3.6 4-5.4 7.5-5.4S18.3 16.4 19.5 20"],
	company: ["M4 21V7l8-4 8 4v14", "M9 21v-5h6v5", "M9 10h.01", "M15 10h.01"],
	deal: ["M4 7h16v12H4z", "M8 7V5h8v2", "M8 13h8"],
	agent: ["M20 12a8 8 0 1 0-3.2 6.4L21 20l-1.2-4A7.9 7.9 0 0 0 20 12z"],
	mcp: ["M12 3v4M12 17v4M3 12h4M17 12h4", "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8"],
	overview: ["M4 5h16", "M4 12h16", "M4 19h10"],
	insight: ["M12 3v4M12 17v4M3 12h4M17 12h4", "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8"],
	chat: ["M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"],
	behavior: ["M4 6h16", "M4 12h11", "M4 18h7"],
	promise: ["M6 4h12v17l-6-3.5L6 21z", "M9.5 9.5l1.8 1.8 3.2-3.4"],
	archive: ["M4 5h16v14H4z", "M8 9h8", "M8 13h5"],
	fields: ["M4 6h10", "M4 12h16", "M4 18h7", "M18 4v4"],
	brain: ["M4 7h16v12H4z", "M9 12h.01", "M15 12h.01", "M9 16h6"],
} as const;

const workbench = [
	{ to: "/", label: "首页", icon: ICONS.home },
	{ to: "/contacts", label: "联系人", icon: ICONS.contact },
	{ to: "/companies", label: "公司", icon: ICONS.company },
	{ to: "/deals", label: "商机", icon: ICONS.deal },
	{ to: "/chat", label: "智能体", icon: ICONS.agent },
	{ to: "/mcp", label: "MCP 接入", icon: ICONS.mcp },
];

function workbenchActive(to: string): boolean {
	if (to === "/") return route.path === "/";

	return route.path === to || route.path.startsWith(`${to}/`);
}

/** 详情页把承诺 / 留底 / 字段建议的待处理数量挂到共享 state，侧栏负责显示红点数字。 */
type NavCounts = { promises: number; archives: number; fields: number };

const contactId = computed(() => {
	const match = route.path.match(/^\/contacts\/([^/]+)/);

	return match ? match[1] : "";
});

/** 与详情页共用同一个 useAsyncData key，SSR 时不会重复请求。 */
const { data: navContact } = await useAsyncData(
	() => `contact-${contactId.value}`,
	() => (contactId.value ? api.contactDetail(contactId.value) : Promise.resolve(null)),
	{ watch: [contactId] },
);

const navCounts = computed<NavCounts | null>(() => {
	const detail = navContact.value as ContactDetail | null;

	if (!detail) return null;

	return {
		promises: (detail.promises ?? []).filter((item) => item.status === "open").length,
		archives: (detail.archives ?? []).length,
		fields: (detail.facts ?? []).filter((fact) => fact.status === "proposed").length,
	};
});

const onInsights = computed(() => route.path.endsWith("/insights"));
const section = computed(() => String(route.query.s ?? "overview"));

const contactNav = computed(() => {
	const base = `/contacts/${contactId.value}`;
	const current = section.value;

	return [
		{ key: "overview", label: "概览", to: base, icon: ICONS.overview, active: !onInsights.value && current === "overview", badge: 0 },
		{ key: "insights", label: "深度画像", to: `${base}/insights`, icon: ICONS.insight, active: onInsights.value, badge: 0 },
		{ key: "deals", label: "商机", to: `${base}?s=deals`, icon: ICONS.deal, active: !onInsights.value && current === "deals", badge: 0 },
		{ key: "timeline", label: "沟通记录", to: `${base}?s=timeline`, icon: ICONS.chat, active: !onInsights.value && current === "timeline", badge: 0 },
		{ key: "behavior", label: "行为记录", to: `${base}?s=behavior`, icon: ICONS.behavior, active: !onInsights.value && current === "behavior", badge: 0 },
		{ key: "promises", label: "承诺账本", to: `${base}?s=promises`, icon: ICONS.promise, active: !onInsights.value && current === "promises", badge: navCounts.value?.promises ?? 0 },
		{ key: "archive", label: "聊天留底", to: `${base}?s=archive`, icon: ICONS.archive, active: !onInsights.value && current === "archive", badge: navCounts.value?.archives ?? 0 },
		{ key: "fields", label: "字段建议", to: `${base}?s=fields`, icon: ICONS.fields, active: !onInsights.value && current === "fields", badge: navCounts.value?.fields ?? 0 },
		{ key: "agent", label: "Agent", to: `${base}?s=agent`, icon: ICONS.brain, active: !onInsights.value && current === "agent", badge: 0 },
	];
});
</script>

<template>
	<div class="app">
		<aside class="sidebar">
			<NuxtLink to="/" class="brand">
				<div class="brand-mark">极</div>
				<div class="brand-name">极简 CRM</div>
			</NuxtLink>

			<div class="nav-group">
				<div class="nav-group__title">工作台</div>
				<NuxtLink
					v-for="item in workbench"
					:key="item.to"
					:to="item.to"
					custom
					v-slot="{ navigate }"
				>
					<a
						:href="item.to"
						class="nav-item"
						:class="{ 'is-active': workbenchActive(item.to) }"
						@click="navigate"
					>
						<svg class="ico" viewBox="0 0 24 24"><path v-for="(d, index) in item.icon" :key="index" :d="d" /></svg>
						{{ item.label }}
						<span
							v-if="item.to === '/contacts'"
							class="nav-item__dot"
							:style="{ background: route.path.startsWith('/contacts') ? '#2563eb' : '#c8cfda' }"
						/>
					</a>
				</NuxtLink>
			</div>

			<div v-if="contactId" class="nav-group">
				<div class="nav-group__title">当前联系人</div>
				<NuxtLink
					v-for="item in contactNav"
					:key="item.key"
					:to="item.to"
					custom
					v-slot="{ navigate }"
				>
					<a
						:href="item.to"
						class="nav-item"
						:class="{ 'is-active': item.active }"
						@click="navigate"
					>
						<svg class="ico" viewBox="0 0 24 24"><path v-for="(d, index) in item.icon" :key="index" :d="d" /></svg>
						{{ item.label }}
						<span v-if="item.badge" class="nav-item__badge">{{ item.badge }}</span>
					</a>
				</NuxtLink>
			</div>

			<el-popover v-if="queueCount > 0" placement="right-end" width="430" trigger="click">
				<template #reference>
					<div class="sidebar__foot is-clickable">
						后台队列 <b>{{ queueCount }} 项</b> 进行中<br />
						<template v-if="scheduledCount > 0">另有 <b>{{ scheduledCount }} 项</b> 已安排复查</template>
						<template v-else>点这里管理排队任务</template>
					</div>
				</template>
				<div class="crm-queue-pop">
					<div class="crm-queue-pop__intro">
						新建记录后的自动研究、「重新研究」按钮和到期复查都在这里后台排队执行，不用盯着等；卡住了可以在下面终止。
					</div>
					<div v-for="task in activeTasks" :key="task.id" class="crm-queue-pop__item">
						<div class="crm-queue-pop__main">
							<div>{{ taskTitle(task) }}</div>
							<div class="crm-muted crm-queue-pop__meta">
								{{ taskStatusText(task) }}
								· {{ formatTaskTime(task.createdAt) }} 提交
								<template v-if="task.payload?.reason"> · {{ task.payload.reason }}</template>
							</div>
						</div>
						<el-button
							size="small"
							link
							type="danger"
							:loading="terminating === task.id"
							@click="terminateTask(task)"
						>
							终止
						</el-button>
					</div>
					<div v-if="activeTasks.length === 0" class="crm-muted">正在刷新明细……</div>
					<div v-if="(status?.failed ?? 0) > 0" class="crm-queue-pop__failed">
						另有 {{ status?.failed }} 项连续失败的任务（原因见服务端日志）。
					</div>
				</div>
			</el-popover>
			<div v-else class="sidebar__foot">
				后台队列 <b>空闲</b><br />
				<template v-if="scheduledCount > 0">已安排 <b>{{ scheduledCount }} 项</b> 未来复查</template>
				<template v-else>没有排队任务</template>
			</div>

			<el-popover v-if="scheduledCount > 0 && queueCount === 0" placement="right-end" width="430" trigger="click">
				<template #reference>
					<div class="sidebar__foot is-clickable">已安排 <b>{{ scheduledCount }} 项</b> 复查<br />点这里查看排期</div>
				</template>
				<div class="crm-queue-pop">
					<div class="crm-queue-pop__intro">
						这些是未来的复查预约：到点自动执行，现在只是排期、不算进行中；不想要可以在这里终止。
					</div>
					<div v-for="task in scheduledTasks" :key="task.id" class="crm-queue-pop__item">
						<div class="crm-queue-pop__main">
							<div>{{ taskTitle(task) }}</div>
							<div class="crm-muted crm-queue-pop__meta">{{ taskStatusText(task) }}</div>
						</div>
						<el-button
							size="small"
							link
							type="danger"
							:loading="terminating === task.id"
							@click="terminateTask(task)"
						>
							终止
						</el-button>
					</div>
				</div>
			</el-popover>

			<a href="/auth/logout" class="sidebar__logout">退出登录</a>
		</aside>

		<main class="main">
			<el-alert
				v-if="status && !status.agentEnabled"
				class="crm-agent-alert"
				type="warning"
				:closable="false"
				show-icon
				:title="status.agentReason"
			/>
			<slot />
		</main>
	</div>
</template>

<style scoped>
.app {
	display: flex;
	min-height: 100vh;
	background: var(--crm-surface);
}

.sidebar {
	width: 232px;
	flex: none;
	background: #fff;
	border-right: 1px solid var(--crm-line);
	position: sticky;
	top: 0;
	height: 100vh;
	display: flex;
	flex-direction: column;
	padding: 14px 10px 12px;
	overflow-y: auto;
	scrollbar-width: none;
	-ms-overflow-style: none;
}

.sidebar::-webkit-scrollbar {
	display: none;
	width: 0;
	height: 0;
}

.brand {
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 2px 10px 12px;
	text-decoration: none;
}

.brand-mark {
	width: 25px;
	height: 25px;
	border-radius: 8px;
	flex: none;
	background: linear-gradient(140deg, #4f8cff, #2563eb);
	box-shadow: 0 2px 6px rgba(37, 99, 235, 0.28);
	display: grid;
	place-items: center;
	color: #fff;
	font-size: 11.5px;
	font-weight: 700;
}

.brand-name {
	font-size: 14px;
	font-weight: 650;
	color: var(--crm-ink);
	letter-spacing: 0.2px;
}

.nav-group {
	margin-top: 12px;
}

.nav-group__title {
	font-size: 10.5px;
	color: #9aa3b2;
	letter-spacing: 0.08em;
	padding: 0 10px;
	margin-bottom: 5px;
}

.nav-item {
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 6.5px 10px;
	border-radius: 7px;
	font-size: 13px;
	color: #4c5563;
	cursor: pointer;
	user-select: none;
	transition: background 0.15s, color 0.15s;
	line-height: 1.5;
	text-decoration: none;
}

.nav-item:hover {
	background: #f3f5f9;
	color: #4c5563;
}

.nav-item.is-active {
	background: #edf3ff;
	color: #2563eb;
	font-weight: 600;
}

.ico {
	width: 15px;
	height: 15px;
	flex: none;
	stroke-width: 1.7;
	stroke: currentColor;
	fill: none;
	stroke-linecap: round;
	stroke-linejoin: round;
	opacity: 0.72;
}

.nav-item.is-active .ico {
	opacity: 1;
}

.nav-item__badge {
	margin-left: auto;
	font-size: 10.5px;
	line-height: 1.5;
	padding: 0 6px;
	border-radius: 999px;
	background: #fff5e2;
	color: #b26a00;
	font-weight: 600;
}

.nav-item__dot {
	margin-left: auto;
	width: 6px;
	height: 6px;
	border-radius: 50%;
}

.sidebar__foot {
	margin-top: auto;
	padding: 10px 10px 0;
	border-top: 1px solid #f0f2f6;
	font-size: 11px;
	color: #9aa3b2;
	line-height: 1.65;
	flex: none;
}

.sidebar__foot b {
	color: #39424f;
	font-weight: 600;
}

.sidebar__foot.is-clickable {
	cursor: pointer;
}

.sidebar__logout {
	display: block;
	flex: none;
	padding: 10px;
	font-size: 12px;
	color: #9aa3b2;
	text-decoration: none;
	border-top: 1px solid #f0f2f6;
}

.sidebar__logout:hover {
	color: #39424f;
}

.main {
	flex: 1;
	min-width: 0;
	padding: 20px 26px 44px;
}

.crm-agent-alert {
	margin-bottom: 16px;
}

.crm-queue-pop__intro {
	font-size: 12px;
	line-height: 1.7;
	color: var(--crm-muted);
	margin-bottom: 10px;
}

.crm-queue-pop__item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 8px 0;
	border-bottom: 1px dashed var(--crm-line);
	font-size: 13px;
}

.crm-queue-pop__item:last-of-type {
	border-bottom: none;
}

.crm-queue-pop__meta {
	font-size: 12px;
	margin-top: 2px;
}

.crm-queue-pop__failed {
	font-size: 12px;
	color: #b3261e;
	margin-top: 8px;
}

@media (max-width: 900px) {
	.sidebar {
		display: none;
	}

	.main {
		padding: 16px 14px 36px;
	}
}
</style>
