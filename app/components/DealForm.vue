<script setup lang="ts">
import { DEAL_STAGES, type Company, type Contact, type Deal } from "~/types/domain";

const props = defineProps<{
	deal?: Deal | null;
	submitting?: boolean;
}>();

const emit = defineEmits<{
	submit: [payload: Record<string, unknown>];
	cancel: [];
}>();

const api = useApi();
const companies = ref<Company[]>([]);
const contacts = ref<Contact[]>([]);

const form = reactive({
	name: "",
	companyId: "",
	contactId: "",
	stage: DEAL_STAGES[0] as string,
	expectedCloseDate: "",
});

watch(
	() => props.deal,
	(deal) => {
		form.name = deal?.name ?? "";
		form.companyId = deal?.companyId ?? "";
		form.contactId = deal?.contactId ?? "";
		form.stage = deal?.stage ?? DEAL_STAGES[0];
		form.expectedCloseDate = deal?.expectedCloseDate ?? "";
	},
	{ immediate: true },
);

onMounted(async () => {
	try {
		const [companyResult, contactResult] = await Promise.all([
			api.companyOptions(),
			api.listContacts({ pageSize: 100 }),
		]);
		companies.value = companyResult.items;
		contacts.value = contactResult.items;
	} catch {
		companies.value = [];
		contacts.value = [];
	}
});

function submit() {
	emit("submit", {
		...form,
		companyId: form.companyId || null,
		contactId: form.contactId || null,
		expectedCloseDate: form.expectedCloseDate || null,
	});
}
</script>

<template>
	<el-form label-width="88px" @submit.prevent>
		<el-form-item label="商机名称" required>
			<el-input v-model="form.name" placeholder="必填" maxlength="191" />
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
		<el-form-item label="联系人">
			<el-select v-model="form.contactId" clearable filterable placeholder="选择联系人" style="width: 100%">
				<el-option
					v-for="contact in contacts"
					:key="contact.id"
					:label="personName(contact)"
					:value="contact.id"
				/>
			</el-select>
		</el-form-item>
		<el-form-item label="阶段">
			<el-select v-model="form.stage" style="width: 100%">
				<el-option v-for="stage in DEAL_STAGES" :key="stage" :label="stage" :value="stage" />
			</el-select>
		</el-form-item>
		<el-form-item label="预计成交">
			<el-date-picker
				v-model="form.expectedCloseDate"
				type="date"
				value-format="YYYY-MM-DD"
				placeholder="选择日期"
				style="width: 100%"
			/>
		</el-form-item>
		<el-form-item>
			<div class="crm-row">
				<el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
				<el-button @click="emit('cancel')">取消</el-button>
			</div>
		</el-form-item>
	</el-form>
</template>
