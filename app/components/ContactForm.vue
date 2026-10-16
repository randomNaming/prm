<script setup lang="ts">
import type { Company, Contact } from "~/types/domain";
import { RELATIONSHIP_REPAIR } from "~/types/domain";
import { COUNTRIES } from "~/utils/countries";
import { parseAddress } from "~/utils/address-parse";

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
const relationshipOptions = ref<string[]>([]);
const gradeOptions = ref<string[]>([]);
const countryNames = ref<string[]>(COUNTRIES.map((country) => country.zh));

const form = reactive({
	firstName: "",
	lastName: "",
	title: "",
	email: "",
	phone: "",
	wechatId: "",
	address: "",
	country: "",
	postalCode: "",
	customerGrade: "",
	businessRole: "",
	relationshipState: "",
	repairNote: "",
	linkedin: "",
	github: "",
	notes: "",
	companyId: "",
});

/** 只有选中「关系待修复」才让人填修复说明。 */
const needsRepair = computed(() => form.relationshipState === RELATIONSHIP_REPAIR);

/** 中文/英文/两位代码都能搜，比如 中国 / america / US。 */
function filterCountry(query: string) {
	const text = query.trim();
	const lower = text.toLowerCase();

	countryNames.value = COUNTRIES.filter(
		(country) =>
			country.zh.includes(text) ||
			country.en.toLowerCase().includes(lower) ||
			country.code.toLowerCase() === lower,
	).map((country) => country.zh);
}

/** 智能填写：粘贴完整地址文本，识别后填进表单。 */
const smartText = ref("");
const smartNote = ref<string | null>(null);

function runSmartFill() {
	const parsed = parseAddress(smartText.value);

	if (!parsed) {
		smartNote.value = "没有认出可填的内容：文本里至少要有电话、国家或街道之一。";
		return;
	}

	if (parsed.name) form.firstName = parsed.name;
	if (parsed.phone) form.phone = parsed.phone;
	if (parsed.email) form.email = parsed.email;
	if (parsed.country) form.country = parsed.country;
	if (parsed.postalCode) form.postalCode = parsed.postalCode;
	if (parsed.address) form.address = parsed.address;

	// 识别成功不占版面回显，字段就摆在下面，一眼能看到；只有认不出时才提示。
	smartNote.value = null;
	smartText.value = "";
}

function clearSmart() {
	smartText.value = "";
	smartNote.value = null;
}
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
		form.country = contact?.country ?? "";
		form.postalCode = contact?.postalCode ?? "";
		form.customerGrade = contact?.customerGrade ?? "";
		form.businessRole = contact?.businessRole ?? "";
		form.relationshipState = contact?.relationshipState ?? "";
		form.repairNote = contact?.repairNote ?? "";
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
		relationshipOptions.value =
			fieldResult.fields.find((field) => field.key === "relationship_state")?.options ?? [];
		gradeOptions.value =
			fieldResult.fields.find((field) => field.key === "customer_grade")?.options ?? [];
	} catch {
		companies.value = [];
		relationOptions.value = [];
		relationshipOptions.value = [];
		gradeOptions.value = [];
	}
});

function submit() {
	emit("submit", {
		...form,
		companyId: form.companyId || null,
		// 关系没标待修复时不提交说明，服务端也会一并清掉。
		repairNote: needsRepair.value ? form.repairNote : "",
	});
}
</script>

<template>
	<el-form label-width="72px" @submit.prevent>
		<el-form-item label="智能填写">
			<div class="crm-smart">
				<el-input
					v-model="smartText"
					type="textarea"
					:rows="3"
					placeholder="粘贴完整地址，例如：Maelle AGONDJO DONDIA +33 668496975, 18 Bd Vincent Auriol, 31170, Tournefeuille, Haute-Garonne, France"
				/>
				<div class="crm-smart__foot">
					<span v-if="smartNote" class="crm-smart__note">{{ smartNote }}</span>
					<span class="crm-row">
						<el-button size="small" @click="clearSmart">清空</el-button>
						<el-button
							size="small"
							type="primary"
							:disabled="!smartText.trim()"
							@click="runSmartFill"
						>
							地址识别
						</el-button>
					</span>
				</div>
			</div>
		</el-form-item>
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
		<el-form-item label="邮编">
			<el-input v-model="form.postalCode" maxlength="32" />
		</el-form-item>
		<el-form-item label="客户等级">
			<el-select
				v-model="form.customerGrade"
				clearable
				filterable
				allow-create
				default-first-option
				placeholder="A 类潜力买家 / B 类稳定客户 / C 类一般客户，也可直接输入新等级"
				style="width: 100%"
			>
				<el-option v-for="option in gradeOptions" :key="option" :label="option" :value="option" />
			</el-select>
		</el-form-item>
		<el-form-item label="国家">
			<el-select
				v-model="form.country"
				clearable
				filterable
				:filter-method="filterCountry"
				placeholder="搜索：中国 / America / US"
				style="width: 100%"
			>
				<el-option v-for="name in countryNames" :key="name" :label="name" :value="name" />
			</el-select>
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
		<el-form-item label="关系维护">
			<el-select
				v-model="form.relationshipState"
				clearable
				filterable
				allow-create
				default-first-option
				placeholder="默认（不用标）；也可直接输入新标签"
				style="width: 100%"
			>
				<el-option
					v-for="option in relationshipOptions"
					:key="option"
					:label="option"
					:value="option"
				/>
			</el-select>
		</el-form-item>
		<el-form-item v-if="needsRepair" label="修复说明">
			<el-input
				v-model="form.repairNote"
				type="textarea"
				:rows="3"
				maxlength="191"
				show-word-limit
				placeholder="要修什么、等到什么条件再谈。例如：计步精度不达标被差评（未退款），等精度达标的新品。"
			/>
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

<style scoped>
.crm-smart {
	width: 100%;
	border: 1px solid var(--crm-line);
	border-radius: 6px;
	padding: 10px;
	background: var(--crm-surface);
}

.crm-smart__foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin-top: 8px;
}

.crm-smart__note {
	flex: 1;
	font-size: 12px;
	line-height: 1.6;
	color: #b3261e;
}
</style>
