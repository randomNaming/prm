<script setup lang="ts">
import type { Company } from "~/types/domain";

const props = defineProps<{
	company?: Company | null;
	submitting?: boolean;
}>();

const emit = defineEmits<{
	submit: [payload: Record<string, unknown>];
	cancel: [];
}>();

const form = reactive({
	name: "",
	domain: "",
	industry: "",
	address: "",
	cooperationRole: "",
	description: "",
});

const relationOptions = ref<string[]>([]);

onMounted(async () => {
	try {
		const result = await useApi().fields("company");
		relationOptions.value =
			result.fields.find((field) => field.key === "cooperation_role")?.options ?? [];
	} catch {
		relationOptions.value = [];
	}
});

watch(
	() => props.company,
	(company) => {
		form.name = company?.name ?? "";
		form.domain = company?.domain ?? "";
		form.industry = company?.industry ?? "";
		form.address = company?.address ?? "";
		form.cooperationRole = company?.cooperationRole ?? "";
		form.description = company?.description ?? "";
	},
	{ immediate: true },
);

function submit() {
	emit("submit", { ...form });
}
</script>

<template>
	<el-form label-width="72px" @submit.prevent>
		<el-form-item label="公司名" required>
			<el-input v-model="form.name" placeholder="必填" maxlength="191" />
		</el-form-item>
		<el-form-item label="域名">
			<el-input v-model="form.domain" maxlength="191" />
		</el-form-item>
		<el-form-item label="行业">
			<el-input v-model="form.industry" maxlength="191" />
		</el-form-item>
		<el-form-item label="公司地址">
			<el-input v-model="form.address" maxlength="191" />
		</el-form-item>
		<el-form-item label="合作角色">
			<el-select
				v-model="form.cooperationRole"
				clearable
				filterable
				allow-create
				default-first-option
				placeholder="客户 / 供应商，也可直接输入新标签"
				style="width: 100%"
			>
				<el-option v-for="option in relationOptions" :key="option" :label="option" :value="option" />
			</el-select>
		</el-form-item>
		<el-form-item label="简介">
			<el-input v-model="form.description" type="textarea" :rows="3" maxlength="4000" />
		</el-form-item>
		<el-form-item>
			<div class="crm-row">
				<el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
				<el-button @click="emit('cancel')">取消</el-button>
			</div>
		</el-form-item>
	</el-form>
</template>
