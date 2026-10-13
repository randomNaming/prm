<script setup lang="ts">
import type { QueueStatus } from "~/types/domain";

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

const navItems = [
	{ to: "/", label: "首页" },
	{ to: "/contacts", label: "联系人" },
	{ to: "/companies", label: "公司" },
	{ to: "/deals", label: "商机" },
	{ to: "/chat", label: "智能体" },
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
					<el-tag v-if="queueCount > 0" type="warning" effect="light">
						队列 {{ queueCount }}
					</el-tag>
					<el-tag v-else type="info" effect="plain">队列空闲</el-tag>
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
</style>
