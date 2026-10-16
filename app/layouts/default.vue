<script setup lang="ts">
import type { AgentTask, QueueStatus } from "~/types/domain";

const api = useApi();

const { data: status, refresh } = await useAsyncData<QueueStatus | null>("queue-status", () =>
	$fetch<QueueStatus>("/api/status").catch(() => null),
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

const navItems = [
	{ to: "/", label: "首页" },
	{ to: "/contacts", label: "联系人" },
	{ to: "/companies", label: "公司" },
	{ to: "/deals", label: "商机" },
	{ to: "/chat", label: "智能体" },
	{ to: "/mcp", label: "MCP 接入" },
];
</script>

<template>
	<el-container>
		<el-header class="crm-header">
			<div class="crm-header__inner">
				<NuxtLink to="/" class="crm-brand">极简 CRM</NuxtLink>
				<nav class="crm-nav">
					<NuxtLink v-for="item in navItems" :key="item.to" :to="item.to" class="crm-nav__link">
						{{ item.label }}
					</NuxtLink>
				</nav>
				<div class="crm-row">
					<el-popover v-if="queueCount > 0" placement="bottom-end" width="430" trigger="click">
						<template #reference>
							<el-tag type="warning" effect="light" class="crm-queue-tag">
								后台研究 · {{ queueCount }} 项进行中（点击管理）
							</el-tag>
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
							<div v-if="activeTasks.length === 0" class="crm-muted">
								正在刷新明细……
							</div>
							<div v-if="(status?.failed ?? 0) > 0" class="crm-queue-pop__failed">
								另有 {{ status?.failed }} 项连续失败的任务（原因见服务端日志）。
							</div>
						</div>
					</el-popover>
					<el-popover v-if="scheduledCount > 0" placement="bottom-end" width="430" trigger="click">
						<template #reference>
							<el-tag type="info" effect="plain" class="crm-queue-tag">
								已安排 {{ scheduledCount }} 项（未来复查，点击管理）
							</el-tag>
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
					<el-tag v-if="status && !status.agentEnabled" type="danger" effect="plain">
						智能体停用
					</el-tag>
				</div>
			</div>
		</el-header>

		<el-main>
			<el-alert
				v-if="status && !status.agentEnabled"
				class="crm-agent-alert"
				type="warning"
				:closable="false"
				show-icon
				:title="status.agentReason"
			/>
			<slot />
		</el-main>
	</el-container>
</template>

<style scoped>
.crm-header {
	background: #fff;
	border-bottom: 1px solid var(--crm-line);
	padding: 0;
}

.crm-header__inner {
	max-width: 1120px;
	margin: 0 auto;
	height: 56px;
	display: flex;
	align-items: center;
	gap: 20px;
	padding: 0 16px;
}

.crm-brand {
	font-weight: 600;
	color: var(--crm-ink);
	text-decoration: none;
}

.crm-nav {
	display: flex;
	gap: 4px;
	flex: 1;
}

.crm-nav__link {
	padding: 4px 10px;
	border-radius: 6px;
	color: var(--crm-muted);
	text-decoration: none;
	font-size: 14px;
}

.crm-nav__link.router-link-active {
	color: var(--crm-brand);
	background: rgba(0, 107, 79, 0.08);
}

.crm-agent-alert {
	margin-bottom: 16px;
}

.crm-queue-tag {
	cursor: pointer;
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
</style>
