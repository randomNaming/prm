<script setup lang="ts">
/**
 * 页面头部：和联系人详情页的 cvd-head 同一套排版（大标题 + 灰蓝 chip + 一行元信息 + 右侧动作），
 * 列表页与首页都用它，避免每页重新发明一个 20px 的标题。
 */
defineProps<{
	title: string;
	/** 标题下面那行灰字；也可以改用 meta 插槽自己拼。 */
	subtitle?: string;
}>();
</script>

<template>
	<header class="cvd-head cvd-pagehead">
		<div class="cvd-head__main">
			<div class="cvd-head__name">
				<h1>{{ title }}</h1>
				<slot name="chips" />
			</div>
			<div v-if="subtitle || $slots.meta" class="cvd-head__meta">
				<span v-if="subtitle">{{ subtitle }}</span>
				<slot name="meta" />
			</div>
		</div>
		<div v-if="$slots.actions" class="cvd-head__actions">
			<slot name="actions" />
		</div>
	</header>
</template>
