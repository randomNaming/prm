<script setup lang="ts">
const props = defineProps<{
	label: string;
	where: string;
	code: string;
}>();

const busy = ref(false);

async function copy() {
	busy.value = true;

	try {
		await navigator.clipboard.writeText(props.code);
		ElMessage.success("已复制，粘贴到客户端配置里即可。");
	} catch {
		ElMessage.error("浏览器不允许自动复制，请手动选中代码块。");
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<div class="crm-snippet">
		<div class="crm-spread">
			<strong class="crm-snippet__label">{{ label }}</strong>
			<el-button size="small" :loading="busy" @click="copy">复制</el-button>
		</div>
		<div class="crm-muted crm-snippet__where">{{ where }}</div>
		<pre class="crm-snippet__code">{{ code }}</pre>
	</div>
</template>

<style scoped>
.crm-snippet {
	border: 1px solid var(--crm-line);
	border-radius: 8px;
	padding: 10px 12px;
	margin-bottom: 12px;
	background: #fff;
}

.crm-snippet__label {
	font-size: 13px;
}

.crm-snippet__where {
	font-size: 12px;
	margin: 4px 0 8px;
}

.crm-snippet__code {
	margin: 0;
	padding: 10px;
	background: var(--crm-surface);
	border-radius: 6px;
	font-size: 12px;
	line-height: 1.6;
	overflow-x: auto;
	white-space: pre;
}
</style>
