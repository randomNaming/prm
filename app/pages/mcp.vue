<script setup lang="ts">
const api = useApi();

const { data } = await useAsyncData("mcp-overview", () => api.mcp());

const servers = computed(() => data.value?.servers ?? []);

const sourceLabels: Record<string, string> = {
	env: "进程环境变量",
	file: "包内 .env",
	missing: "未配置",
};
</script>

<template>
	<div class="crm-page">
		<div class="crm-section">
			<h1 class="crm-title">MCP 接入</h1>
			<p class="crm-muted">
				平台不替客户端拉起 MCP Server，只把「写侧包现在的状态」和「可直接粘贴的客户端配置」摆在这里。
				把 JSON 复制到你的 agent 客户端就能连上。
			</p>
		</div>

		<el-alert
			v-for="note in data?.notes ?? []"
			:key="note"
			class="crm-section"
			type="info"
			:closable="false"
			show-icon
			:title="note"
		/>

		<section v-for="server in servers" :key="server.id" class="crm-card crm-server">
			<div class="crm-spread">
				<h2 class="crm-section__title">
					{{ server.name }}
					<el-tag size="small" effect="plain" class="crm-server__tag">{{ server.direction }}</el-tag>
				</h2>
				<el-tag v-if="server.ready" type="success" effect="light" size="small">已就绪</el-tag>
				<el-tag v-else type="warning" effect="light" size="small">还需处理</el-tag>
			</div>

			<p class="crm-muted crm-server__summary">{{ server.summary }}</p>

			<el-alert
				v-for="blocker in server.blockers"
				:key="blocker"
				class="crm-server__blocker"
				type="warning"
				:closable="false"
				show-icon
				:title="blocker"
			/>

			<div v-if="server.blockers.length > 0" class="crm-server__build">
				<div class="crm-muted crm-server__build-title">在该目录下执行：</div>
				<pre class="crm-server__cmd">{{ server.buildCommands.join("\n") }}</pre>
			</div>

			<h3 class="crm-server__subtitle">配置项</h3>
			<div class="crm-kv">
				<div v-for="item in server.env" :key="item.key" class="crm-kv__row">
					<div class="crm-kv__key">
						<code>{{ item.key }}</code>
						<el-tag v-if="item.required" type="danger" size="small" effect="plain">必填</el-tag>
						<el-tag v-else size="small" effect="plain">可选</el-tag>
					</div>
					<div class="crm-kv__value">
						<div v-if="item.value" class="crm-kv__current">{{ item.value }}</div>
						<div v-else class="crm-muted">未配置</div>
						<div class="crm-muted crm-kv__desc">
							{{ item.description }}
							<span class="crm-kv__source">来源：{{ sourceLabels[item.source] ?? item.source }}</span>
						</div>
					</div>
				</div>
			</div>

			<h3 class="crm-server__subtitle">提供的工具</h3>
			<div v-for="tool in server.tools" :key="tool.name" class="crm-timeline-item">
				<code class="crm-server__tool">{{ tool.name }}</code>
				<span class="crm-muted">{{ tool.summary }}</span>
			</div>

			<h3 class="crm-server__subtitle">客户端配置（复制即用）</h3>
			<CodeSnippet
				v-for="snippet in server.snippets"
				:key="snippet.label"
				:label="snippet.label"
				:where="snippet.where"
				:code="snippet.json"
			/>

			<div class="crm-muted crm-server__path">
				入口文件：<code>{{ server.entry }}</code>
				<el-tag :type="server.entryExists ? 'success' : 'warning'" size="small" effect="plain">
					{{ server.entryExists ? "已编译" : "未编译" }}
				</el-tag>
			</div>
			<div class="crm-muted crm-server__path">
				配置文件：<code>{{ server.envFile }}</code>
				<el-tag :type="server.envFileExists ? 'success' : 'info'" size="small" effect="plain">
					{{ server.envFileExists ? "存在" : "未创建" }}
				</el-tag>
			</div>
		</section>

		<section class="crm-card crm-section">
			<h2 class="crm-section__title">不装 MCP 客户端也能写入</h2>
			<p class="crm-muted">
				MCP 是可选的接入方式。任何能发 HTTP 请求的脚本都可以直接调平台的
				<code>POST {{ data?.platformBaseUrl ?? "" }}/api/intake</code>，
				走的是同一条智能体抽取链路，效果与 <code>mcp-crm</code> 的
				<code>import_wechat_chat</code> 完全一致。
			</p>
		</section>
	</div>
</template>

<style scoped>
.crm-title {
	font-size: 20px;
	margin: 0 0 6px;
}

.crm-server {
	margin-bottom: 20px;
}

.crm-server__tag {
	margin-left: 8px;
	font-weight: 400;
}

.crm-server__summary {
	margin: 8px 0 12px;
	line-height: 1.7;
}

.crm-server__blocker {
	margin-bottom: 8px;
}

.crm-server__build {
	margin-bottom: 12px;
}

.crm-server__build-title {
	font-size: 12px;
	margin-bottom: 4px;
}

.crm-server__cmd {
	margin: 0;
	padding: 8px 10px;
	background: var(--crm-surface);
	border-radius: 6px;
	font-size: 12px;
	line-height: 1.6;
	white-space: pre;
	overflow-x: auto;
}

.crm-server__subtitle {
	font-size: 14px;
	font-weight: 600;
	margin: 16px 0 8px;
}

.crm-server__tool {
	margin-right: 8px;
	color: var(--crm-brand);
}

.crm-server__path {
	font-size: 12px;
	margin-top: 6px;
}

.crm-kv__row {
	display: grid;
	grid-template-columns: 240px 1fr;
	gap: 12px;
	padding: 8px 0;
	border-bottom: 1px dashed var(--crm-line);
}

.crm-kv__row:last-child {
	border-bottom: none;
}

.crm-kv__key {
	display: flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
}

.crm-kv__current {
	font-size: 13px;
	word-break: break-all;
}

.crm-kv__desc {
	font-size: 12px;
	margin-top: 4px;
	line-height: 1.6;
}

.crm-kv__source {
	margin-left: 6px;
}

code {
	background: var(--crm-surface);
	padding: 1px 5px;
	border-radius: 4px;
	font-size: 12px;
}
</style>
