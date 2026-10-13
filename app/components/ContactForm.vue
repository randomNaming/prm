<script setup lang="ts">
import type { Company, Contact } from "~/types/domain";

const props = defineProps<{
	contact?: Contact | null;
	submitting?: boolean;
}>();

const emit = defineEmits<{
	submit: [payload: Record<string, unknown>];
	cancel: [];
}>();

const api = useApi();
const companies = ref<Company[]>([]);
const relationOptions = ref<string[]>([]);

const form = reactive({
	firstName: "",
	lastName: "",
	title: "",
	email: "",
	phone: "",
	wechatId: "",
	address: "",
	businessRole: "",
	linkedin: "",
	github: "",
	notes: "",
	companyId: "",
});

watch(
	() => props.contact,
	(contact) => {
		form.firstName = contact?.firstName ?? "";
		form.lastName = contact?.lastName ?? "";
		form.title = contact?.title ?? "";
		form.email = contact?.email ?? "";
		form.phone = contact?.phone ?? "";
		form.wechatId = contact?.wechatId ?? "";
		form.address = contact?.address ?? "";
		form.businessRole = contact?.businessRole ?? "";
		form.linkedin = contact?.linkedin ?? "";
		form.github = contact?.github ?? "";
		form.notes = contact?.notes ?? "";
		form.companyId = contact?.companyId ?? "";
	},
	{ immediate: true },
);

onMounted(async () => {
	try {
		const [companyResult, fieldResult] = await Promise.all([
			api.companyOptions(),
			api.fields("contact"),
		]);
		companies.value = companyResult.items;
		relationOptions.value =
			fieldResult.fields.find((field) => field.key === "business_role")?.options ?? [];
	} catch {
		companies.value = [];
		relationOptions.value = [];
	}
});

function submit() {
	emit("submit", { ...form, companyId: form.companyId || null });
}
</script>

<template>
	<el-form label-width="72px" @submit.prevent>
		<el-form-item label="姓名" required>
			<el-input v-model="form.firstName" placeholder="必填" maxlength="191" />
		</el-form-item>
		<el-form-item label="职位">
			<el-input v-model="form.title" maxlength="191" />
		</el-form-item>
		<el-form-item label="公司">
			<el-select v-model="form.companyId" clearable filterable placeholder="选择公司" style="width: 100%">
				<el-option
					v-for="company in companies"
					:key="company.id"
					:label="company.name"
					:value="company.id"
				/>
			</el-select>
		</el-form-item>
		<el-form-item label="邮箱">
			<el-input v-model="form.email" maxlength="191" />
		</el-form-item>
		<el-form-item label="电话">
			<el-input v-model="form.phone" maxlength="64" />
		</el-form-item>
		<el-form-item label="微信号">
			<el-input v-model="form.wechatId" maxlength="191" />
		</el-form-item>
		<el-form-item label="地址">
			<el-input v-model="form.address" maxlength="191" />
		</el-form-item>
		<el-form-item label="业务角色">
			<el-select
				v-model="form.businessRole"
				clearable
				filterable
				allow-create
				default-first-option
				placeholder="对接人 / 决策人 / 技术 / 老板 / 采购，也可直接输入新标签"
				style="width: 100%"
			>
				<el-option v-for="option in relationOptions" :key="option" :label="option" :value="option" />
			</el-select>
		</el-form-item>
		<el-form-item label="领英">
			<el-input v-model="form.linkedin" maxlength="191" />
		</el-form-item>
		<el-form-item label="GitHub">
			<el-input v-model="form.github" maxlength="191" />
		</el-form-item>
		<el-form-item label="备注">
			<el-input v-model="form.notes" type="textarea" :rows="3" maxlength="4000" />
		</el-form-item>
		<el-form-item>
			<div class="crm-row">
				<el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
				<el-button @click="emit('cancel')">取消</el-button>
			</div>
		</el-form-item>
	</el-form>
</template>
