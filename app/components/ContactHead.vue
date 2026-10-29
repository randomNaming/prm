<script setup lang="ts">
import type { Contact } from "~/types/domain";

const props = defineProps<{
	contact: Contact;
	companyName: string | null;
	companyId: string | null;
	initials: string;
	addressTail: string;
	researching: boolean;
	researchBusy: boolean;
}>();

defineEmits<{
	research: [];
	note: [];
	edit: [];
	archive: [];
	cancelResearch: [];
}>();

const metaPlaceholder = computed(() => props.contact.title ?? "职位未知");
</script>

<template>
	<div class="cvd-head">
		<div class="cvd-avatar">{{ initials }}</div>
		<div class="cvd-head__main">
			<div class="cvd-head__name">
				<h1>{{ personName(contact) }}</h1>
				<span v-if="contact.customerGrade" class="cvd-chip">{{ contact.customerGrade }}</span>
				<span v-if="contact.businessRole" class="cvd-chip cvd-chip--plain">{{ contact.businessRole }}</span>
				<span v-if="contact.relationshipState" class="cvd-chip cvd-chip--plain">{{ contact.relationshipState }}</span>
			</div>
			<div class="cvd-head__meta">
				<span v-if="contact.title || companyName">
					{{ metaPlaceholder }}
					<template v-if="companyName && companyId">
						· <NuxtLink :to="`/companies/${companyId}`" class="crm-link">{{ companyName }}</NuxtLink>
					</template>
					<template v-else-if="companyName">· {{ companyName }}</template>
				</span>
				<template v-if="contact.country || addressTail">
					<span class="cvd-sep">·</span>
					<span>{{ [contact.country, addressTail].filter(Boolean).join(" · ") }}</span>
				</template>
				<span class="cvd-sep">·</span>
				<span>{{ contact.lastResearchedAt ? `最近研究 ${formatDate(contact.lastResearchedAt)}` : "尚未研究" }}</span>
				<template v-if="researching">
					<span class="cvd-sep">·</span>
					<el-popconfirm
						title="终止这项后台研究？"
						confirm-button-text="终止"
						cancel-button-text="再等等"
						@confirm="$emit('cancelResearch')"
					>
						<template #reference>
							<el-link type="warning" :underline="false">正在研究，点此终止</el-link>
						</template>
					</el-popconfirm>
				</template>
			</div>
		</div>
		<div class="cvd-head__actions">
			<button class="cvd-btn cvd-btn--primary" :disabled="researchBusy" @click="$emit('research')">
				{{ researchBusy ? "研究中…" : "重新研究" }}
			</button>
			<button class="cvd-btn" @click="$emit('note')">记一条活动</button>
			<button class="cvd-btn" @click="$emit('edit')">编辑</button>
			<el-popconfirm title="归档后不在列表显示，确定吗？" @confirm="$emit('archive')">
				<template #reference>
					<button class="cvd-btn cvd-btn--danger">归档</button>
				</template>
			</el-popconfirm>
		</div>
	</div>
</template>
