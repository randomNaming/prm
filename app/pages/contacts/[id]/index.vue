<script setup lang="ts">
import {
	ACTIVITY_KIND_LABELS,
	COUNTERPART_TYPE_LABELS,
	DEAL_STAGES,
	FACT_FIELDS,
	FACT_FIELD_LABELS,
	PROMISE_STATUS_LABELS,
	RELATIONSHIP_REPAIR,
	SPECTRUM_AXES,
} from "~/types/domain";
import type {
	Activity,
	DualTrackPayload,
	InsightItem,
	IntakeArchive,
	PlaybookPayload,
	PromiseItem,
	PublicHoliday,
} from "~/types/domain";
import { copyText } from "~/utils/clipboard";

const api = useApi();
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));

const { data, refresh } = await useAsyncData(`contact-${id.value}`, () =>
	api.contactDetail(id.value),
);

const { data: fieldDefs, refresh: refreshFields } = await useAsyncData(`contact-fields`, () =>
	api.fields("contact"),
);

const BUILTIN_KEYS = new Set<string>([
	...FACT_FIELDS,
	// 这三个有独立数据库列，「基本信息」里已经单独渲染，不再挤进自定义字段区重复一遍。
	"business_role",
	"relationship_state",
	"repair_note",
]);

const fieldLabels = computed(() => {
	const labels: Record<string, string> = { ...FACT_FIELD_LABELS };

	for (const field of fieldDefs.value?.fields ?? []) {
		if (field.status === "active") labels[field.key] = field.label;
	}

	return labels;
});

const customFacts = computed(() =>
	(data.value?.facts ?? []).filter(
		(fact) => fact.status === "applied" && !BUILTIN_KEYS.has(fact.field),
	),
);

/** 侧栏「当前联系人」驱动的分区：概览以外的内容不进横向标签栏。 */
const SECTIONS = ["overview", "deals", "timeline", "behavior", "promises", "archive", "fields", "agent"] as const;

const section = computed(() => {
	const value = String(route.query.s ?? "overview");

	return (SECTIONS as readonly string[]).includes(value) ? value : "overview";
});

function goSection(key: string) {
	void router.push({ path: `/contacts/${id.value}`, query: key === "overview" ? {} : { s: key } });
}

const showEdit = ref(false);
const showNote = ref(false);
const showFull = ref(false);
const noteSaving = ref(false);
const submitting = ref(false);
const errorText = ref("");
const factBusy = ref(false);
const researchBusy = ref(false);
const noteTitle = ref("");
const noteBody = ref("");
const archiveBusy = ref("");
const openedArchive = ref("");
const archiveText = ref("");
const archiveError = ref("");

/** 红点只数没看过的留底；打开「聊天留底」标签即视为全部看过。 */
const unreadArchives = computed(
	() => (data.value?.archives ?? []).filter((item) => item.viewedAt === null).length,
);

// ===== 关系洞察（三层冰山的上两层）=====

const playbook = computed(() => {
	const insight = data.value?.insights.find((item) => item.kind === "playbook");
	return insight ? (insight.payload as PlaybookPayload) : null;
});

const dualTrack = computed(() => {
	const insight = data.value?.insights.find((item) => item.kind === "dual_track");
	return insight ? (insight.payload as DualTrackPayload) : null;
});

/** 左栏的深度归因卡片组：商务潜力 + 痛点防御；旧数据的 profile 也降级渲染在这里。 */
const deepGroups = computed(() => {
	if (!playbook.value) return [];

	return [
		{ key: "business", label: "商务潜力", dot: "#9a6b2f", items: playbook.value.business_value ?? [] },
		{ key: "pain", label: "痛点与防御", dot: "#b05c43", items: playbook.value.pain_points ?? [] },
		{ key: "profile", label: "画像与属性标签", dot: "#7c8b99", items: playbook.value.profile ?? [] },
	].filter((group) => group.items.length > 0);
});

/** 中栏的性格光谱条：极性词来自 SPECTRUM_AXES，分数越高越靠右端。 */
const spectrumAxes = computed(() => {
	const spectrums = playbook.value?.personality_spectrums;
	if (!spectrums) return [];

	return SPECTRUM_AXES.map((axis) => ({ ...axis, side: spectrums[axis.key] }));
});

const smallTalk = computed(() => playbook.value?.small_talk_playbook ?? null);

const dualTracks = computed(() => {
	if (!dualTrack.value) return [];

	return [
		{ key: "transaction", label: "事务健康度", side: dualTrack.value.transaction_health },
		{ key: "trust", label: "个人信任", side: dualTrack.value.personal_trust },
	];
});

function trackBarWidth(score: number | null): string {
	return `${Math.max(0, Math.min(100, ((score ?? 0) + 100) / 2))}%`;
}

/** 原话依据的展开状态，key = `组-序号`。换新 Set 才能触发响应式更新。 */
const expandedEvidence = ref(new Set<string>());

function toggleEvidence(key: string) {
	const next = new Set(expandedEvidence.value);

	if (next.has(key)) {
		next.delete(key);
	} else {
		next.add(key);
	}

	expandedEvidence.value = next;
}

/** 破冰话术一键复制（只复制英文原文）。内网 http 下 copyText 自带兜底。 */
const icebreakerCopied = ref(false);
let icebreakerTimer: ReturnType<typeof setTimeout> | null = null;

/** 界面只显示中文意译；复制时给客户的是智能体写的英文原文。 */
async function copyIcebreaker() {
	const icebreaker = smallTalk.value?.ready_to_use_icebreaker;
	const text = icebreaker?.en ?? icebreaker?.zh ?? "";

	if (!text || !(await copyText(text))) return;

	icebreakerCopied.value = true;
	if (icebreakerTimer) clearTimeout(icebreakerTimer);
	icebreakerTimer = setTimeout(() => {
		icebreakerCopied.value = false;
	}, 2000);
}

// ===== 双向承诺账本 =====

const promiseBusy = ref("");
const promiseError = ref("");

const openPromises = computed(() => (data.value?.promises ?? []).filter((item) => item.status === "open"));

const promiseGroups = computed(() =>
	(["ours", "theirs"] as const)
		.map((direction) => ({
			direction,
			label: direction === "ours" ? "我方欠对方" : "对方欠我方",
			/** 我方欠的，兑现动作叫我「已兑现」；对方欠的，是我方收货「已收到」。 */
			fulfilledLabel: direction === "ours" ? "已兑现" : "已收到",
			items: openPromises.value.filter((item) => item.direction === direction),
		}))
		.filter((group) => group.items.length > 0),
);

const openPromiseCount = computed(() => {
	const ours = openPromises.value.filter((item) => item.direction === "ours").length;

	return { ours, theirs: openPromises.value.length - ours };
});

async function closePromiseItem(item: PromiseItem, action: "fulfilled" | "cancelled") {
	promiseBusy.value = item.id;
	promiseError.value = "";

	try {
		await api.decidePromise(item.id, action);
		await refresh();
	} catch (error) {
		promiseError.value = error instanceof Error ? error.message : "操作失败。";
	} finally {
		promiseBusy.value = "";
	}
}

/** 完整寄收件地址 = 地址 + 国家，一键复制。内网 http 下没有剪贴板 API，copyText 有兜底。 */
const addressCopied = ref(false);
let addressCopyTimer: ReturnType<typeof setTimeout> | null = null;

async function copyAddress() {
	const full = [data.value?.contact.address, data.value?.contact.postalCode, data.value?.contact.country]
		.filter(Boolean)
		.join(", ");

	if (!full || !(await copyText(full))) return;

	addressCopied.value = true;
	if (addressCopyTimer) clearTimeout(addressCopyTimer);
	addressCopyTimer = setTimeout(() => {
		addressCopied.value = false;
	}, 2000);
}

watch(section, async (tab) => {
	if (tab !== "archive" || unreadArchives.value === 0) return;

	try {
		await api.markArchivesViewed(id.value);
		await refresh();
	} catch {
		// 标已读失败就先留着红点，下次打开再试；这只是个提示标记，不值得弹错。
	}
});

/**
 * 聊天留底只读：原文存在会话的 user 消息里，按需取回，
 * 不塞进详情接口 —— 一段导出动辄上万字。
 */
async function toggleArchive(item: IntakeArchive) {
	if (openedArchive.value === item.conversationId) {
		openedArchive.value = "";

		return;
	}

	archiveBusy.value = item.conversationId;
	archiveError.value = "";

	try {
		const result = await api.messages(item.conversationId);
		const original = result.messages.find((message) => message.role === "user");

		archiveText.value = original?.content ?? "（这条留底里没有找到原文）";
		openedArchive.value = item.conversationId;
	} catch (error) {
		archiveError.value = error instanceof Error ? error.message : "原文读取失败。";
	} finally {
		archiveBusy.value = "";
	}
}

async function editContact(payload: Record<string, unknown>) {
	submitting.value = true;
	errorText.value = "";

	try {
		await api.updateContact(id.value, payload);
		showEdit.value = false;
		await refresh();
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "保存失败。";
	} finally {
		submitting.value = false;
	}
}

async function archive() {
	await api.archiveContact(id.value);
	await router.push("/contacts");
}

async function research() {
	researchBusy.value = true;

	try {
		await api.research("contact", id.value);
		await refresh();
	} finally {
		researchBusy.value = false;
	}
}

/** 卡死的后台研究允许人工终止；正在跑的那一次会被请求级超时兜住很快退出。 */
const cancelBusy = ref(false);

async function cancelResearch() {
	cancelBusy.value = true;

	try {
		await api.cancelResearch("contact", id.value);
		await refresh();
	} finally {
		cancelBusy.value = false;
	}
}

async function decideFact(payload: { id: string; action: "accept" | "reject" | "revert" }) {
	factBusy.value = true;

	try {
		await api.decideFact(payload.id, payload.action);
		await refresh();
	} finally {
		factBusy.value = false;
	}
}

async function decideField(payload: { id: string; action: "accept" | "reject" }) {
	factBusy.value = true;

	try {
		await api.decideField(payload.id, payload.action);
		await Promise.all([refresh(), refreshFields()]);
	} finally {
		factBusy.value = false;
	}
}

async function submitNote() {
	if (!noteTitle.value.trim() || noteSaving.value) return;

	noteSaving.value = true;

	try {
		await api.createActivity({
			kind: "note",
			title: noteTitle.value.trim(),
			body: noteBody.value || null,
			contactId: id.value,
			companyId: data.value?.contact.companyId ?? null,
		});

		noteTitle.value = "";
		noteBody.value = "";
		showNote.value = false;
		await refresh();
	} finally {
		noteSaving.value = false;
	}
}

async function changeStage(dealId: string, stage: string) {
	await api.changeDealStage(dealId, stage);
	await refresh();
}

// ===== 概览：头部与派生数据 =====

const personInitials = computed(() => {
	const words = (data.value?.contact.firstName ?? "").split(/\s+/).filter(Boolean);

	return (
		words
			.slice(0, 2)
			.map((word) => word.charAt(0).toUpperCase())
			.join("") || "—"
	);
});

/** 地址只留最后两段（区 · 州），完整地址在「查看完整信息」里。 */
const addressTail = computed(() => {
	const parts = (data.value?.contact.address ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);

	return parts.slice(-2).join(" · ");
});

/** 关系待修复，或短标签本身在讲风险，就染成红调；这只是配色，不改数据。 */
function tagIsRisk(tag: string): boolean {
	if (data.value?.contact.relationshipState === RELATIONSHIP_REPAIR) return true;

	return /受损|风险|流失|不信任|冷淡|警惕/.test(tag);
}

const basicRows = computed(() => {
	const contact = data.value?.contact;

	if (!contact) return [];

	return [
		{ label: "邮箱", value: contact.email ?? "—", suffix: "" },
		{ label: "电话", value: contact.phone ?? "—", suffix: "" },
		{ label: "地址", value: contact.address ?? "—", suffix: contact.postalCode ?? "" },
		{ label: "国家", value: contact.country ?? "—", suffix: "" },
		{ label: "等级", value: contact.customerGrade ?? "—", suffix: "" },
		{ label: "角色", value: contact.businessRole ?? "—", suffix: "" },
	];
});

const basicInfoCount = computed(
	() => basicRows.value.filter((row) => row.value !== "—").length,
);

/** 概览只摆最硬的 5 条画像，其余去深度画像整页看。 */
const profileFeed = computed(() => {
	const book = playbook.value;

	if (!book) return [] as Array<InsightItem & { group: "pos" | "risk" | "tag" }>;

	const rows: Array<InsightItem & { group: "pos" | "risk" | "tag" }> = [
		...(book.business_value ?? []).map((item) => ({ ...item, group: "pos" as const })),
		...(book.pain_points ?? []).map((item) => ({ ...item, group: "risk" as const })),
		...(book.profile ?? []).map((item) => ({ ...item, group: "tag" as const })),
	];

	return rows.sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0)).slice(0, 5);
});

const profileCount = computed(() => {
	const book = playbook.value;

	if (!book) return 0;

	return (book.business_value?.length ?? 0) + (book.pain_points?.length ?? 0) + (book.profile?.length ?? 0);
});

const recentActivities = computed(() =>
	[...(data.value?.activities ?? [])].sort((left, right) => right.createdAt - left.createdAt).slice(0, 4),
);

function activityTone(activity: Activity): "" | "warm" | "ok" {
	if (activity.completedAt) return "ok";
	if (activity.kind === "task") return "warm";

	return "";
}

/** 只从原话时间戳里取「月-日」，概览里不需要年份。 */
function shortDate(value: string | null | undefined): string {
	if (!value) return "";

	const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);

	return match ? `${match[2]}-${match[3]}` : value;
}

const insightUpdatedAt = computed(() => {
	const insight = data.value?.insights.find((item) => item.kind === "playbook") ?? data.value?.insights[0];

	return insight ? formatDate(insight.createdAt) : "尚未研究";
});

type Behavior = { key: string; title: string; time: string; pill: string; tone: "ok" | "done" };

/** 行为记录 = 已完成的任务 + 已闭环的承诺，按发生时间倒序混排。 */
const allBehaviors = computed<Behavior[]>(() => {
	const rows: Array<Behavior & { at: number }> = [];

	for (const activity of data.value?.activities ?? []) {
		if (activity.kind !== "task" || !activity.completedAt) continue;

		rows.push({
			at: activity.completedAt,
			key: `activity-${activity.id}`,
			title: activity.title,
			time: activity.dueAt
				? `截止 ${formatDate(activity.dueAt)} · 已完成`
				: `${formatDate(activity.completedAt)} 完成`,
			pill: "已完成",
			tone: "ok",
		});
	}

	for (const promise of data.value?.promises ?? []) {
		if (promise.status === "open") continue;

		rows.push({
			at: promise.closedAt ?? promise.createdAt,
			key: `promise-${promise.id}`,
			title: promise.title,
			time: promise.closedAt
				? `${formatDate(promise.closedAt)} · ${PROMISE_STATUS_LABELS[promise.status]}`
				: PROMISE_STATUS_LABELS[promise.status],
			pill: promise.status === "fulfilled" ? "已兑现" : "已关闭",
			tone: promise.status === "fulfilled" ? "ok" : "done",
		});
	}

	return rows.sort((left, right) => right.at - left.at).slice(0, 6);
});

/** 概览右列只看最近 6 条，完整列表在「行为记录」分区。 */
const behaviors = computed(() => allBehaviors.value.slice(0, 6));

/** 已闭环的承诺：承诺账本里和待办分开展示。 */
const closedPromises = computed(() =>
	(data.value?.promises ?? [])
		.filter((item) => item.status !== "open")
		.sort((left, right) => (right.closedAt ?? right.createdAt) - (left.closedAt ?? left.createdAt)),
);

// ===== 迷你日历：对方国家公众假期 + 中国假期对照 =====

const today = new Date();
const calYear = ref(today.getFullYear());
const calMonth = ref(today.getMonth());

const holidays = ref<PublicHoliday[]>([]);
const cnHolidays = ref<PublicHoliday[]>([]);
const holidayState = ref<"idle" | "loading" | "ok" | "unavailable">("idle");
const holidayReason = ref("");

const hasCalendar = computed(() => Boolean(data.value?.contact.country));

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function dateKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");

	return `${date.getFullYear()}-${month}-${day}`;
}

const holidayMap = computed(() => new Map(holidays.value.map((item) => [item.date, item])));
const cnHolidayMap = computed(() => new Map(cnHolidays.value.map((item) => [item.date, item])));

async function loadHolidays() {
	const country = data.value?.contact.country;

	if (!country) return;

	holidayState.value = "loading";
	holidayReason.value = "";

	try {
		// 中国假期只是对照，取不到不影响对方那一半。
		const [own, cn] = await Promise.all([
			api.publicHolidays(country, calYear.value),
			api.publicHolidays("中国", calYear.value).catch(() => null),
		]);

		holidays.value = own.holidays;
		cnHolidays.value = cn?.holidays ?? [];

		if (own.source === "unavailable") {
			holidayState.value = "unavailable";
			holidayReason.value = own.reason ?? "暂时取不到这个国家的公众假期。";
		} else {
			holidayState.value = "ok";
		}
	} catch {
		holidayState.value = "unavailable";
		holidayReason.value = "公共假期服务暂时连不上。";
	}
}

onMounted(loadHolidays);

/** 周一为第一列；跨月补齐首尾，行数按当月实际周数取，不硬撑成 6 行。 */
const calendarDays = computed(() => {
	const first = new Date(calYear.value, calMonth.value, 1);
	const offset = (first.getDay() + 6) % 7;
	const total = new Date(calYear.value, calMonth.value + 1, 0).getDate();
	const cells = Math.ceil((offset + total) / 7) * 7;

	return Array.from({ length: cells }, (_, index) => {
		const date = new Date(calYear.value, calMonth.value, 1 - offset + index);
		const key = dateKey(date);
		const own = holidayMap.value.get(key) ?? null;
		const cn = own ? null : (cnHolidayMap.value.get(key) ?? null);

		return {
			key: `${key}-${index}`,
			day: date.getDate(),
			out: date.getMonth() !== calMonth.value,
			weekend: [0, 6].includes(date.getDay()),
			column: index % 7,
			hasMark: Boolean(own || cn),
			isCn: Boolean(cn),
			markName: own?.name ?? cn?.name ?? "",
			markDate: own?.date ?? cn?.date ?? "",
		};
	});
});

/** 「10-05 周一 · 12 天后」，让外贸同事一眼看出还有多久。 */
function holidayMeta(dateText: string): string {
	const target = new Date(`${dateText}T00:00:00`);
	const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const diff = Math.round((target.getTime() - start.getTime()) / 86400000);
	const when = diff === 0 ? "今天" : diff > 0 ? `${diff} 天后` : `已过 ${-diff} 天`;

	return `${dateText.slice(5)} ${WEEKDAYS[target.getDay()]} · ${when}`;
}

function holidayHint(isCn: boolean): string {
	if (isCn) return "中国假期，出口报关与工厂停产，节前截单要提前。";

	return `${data.value?.contact.country ?? "对方所在国"}公众假期，当地办公室与物流大概率停摆。`;
}
</script>

<template>
	<div class="crm-page">
		<div v-if="!data" class="crm-card">
			<el-empty description="联系人不存在或已被归档" />
		</div>

		<template v-else>
			<div class="cvd">
				<ContactHead
					v-if="section !== 'overview'"
					:contact="data.contact"
					:company-name="data.company?.name ?? null"
					:company-id="data.company?.id ?? null"
					:initials="personInitials"
					:address-tail="addressTail"
					:researching="data.researching"
					:research-busy="researchBusy"
					@research="research"
					@note="showNote = true"
					@edit="showEdit = true"
					@archive="archive"
					@cancel-research="cancelResearch"
				/>

				<div class="cvd-sections">
					<template v-if="section === 'overview'">
						<div class="cvd">
							<div class="cvd-intro" :class="{ 'cvd-intro--solo': !hasCalendar }">
								<ContactHead
									:contact="data.contact"
									:company-name="data.company?.name ?? null"
									:company-id="data.company?.id ?? null"
									:initials="personInitials"
									:address-tail="addressTail"
									:researching="data.researching"
									:research-busy="researchBusy"
									@research="research"
									@note="showNote = true"
									@edit="showEdit = true"
									@archive="archive"
									@cancel-research="cancelResearch"
								/>
								<div class="cvd-hero">
								<div class="cvd-hero__left">
									<p v-if="playbook?.executive_summary" class="cvd-quote">{{ playbook.executive_summary }}</p>
									<p v-else class="cvd-quote cvd-quote--empty">
										还没有人物白描。点「重新研究」，智能体会补一段一针见血的总括。
									</p>
									<div v-if="playbook?.short_tags.length" class="cvd-tags">
										<span
											v-for="tag in playbook.short_tags"
											:key="tag"
											class="cvd-tag"
											:class="{ 'cvd-tag--risk': tagIsRisk(tag) }"
										>{{ tag }}</span>
									</div>
								</div>

								<aside v-if="hasCalendar" class="cvd-calcard">
									<div class="cvd-cal__head">
										<span class="cvd-cal__month">{{ calMonth + 1 }} 月</span>
										<span class="cvd-cal__year">{{ calYear }}</span>
									</div>

									<div v-if="holidayState === 'unavailable'" class="cvd-cal__empty">
										<b>日历暂不可用</b>
										<span>{{ holidayReason }}</span>
										<span>联系方式、画像与承诺不受影响。</span>
									</div>
									<template v-else>
										<div class="cvd-cal__grid">
											<span v-for="dow in ['一', '二', '三', '四', '五', '六', '日']" :key="dow" class="cvd-cal__dow">{{ dow }}</span>
											<span
												v-for="cell in calendarDays"
												:key="cell.key"
												class="cvd-cal__day"
												:class="{
													'cvd-cal__day--out': cell.out,
													'cvd-cal__day--weekend': cell.weekend,
													'cvd-cal__day--holiday': cell.hasMark && !cell.isCn,
													'cvd-cal__day--cn': cell.isCn,
												}"
												:tabindex="cell.hasMark ? 0 : -1"
											>
												<span
													v-if="cell.hasMark"
													class="cvd-cal__pop"
													:class="cell.column <= 1 ? 'cvd-cal__pop--r' : cell.column >= 5 ? 'cvd-cal__pop--l' : ''"
												>
													<b>{{ cell.markName }}</b>
													<span>{{ holidayMeta(cell.markDate) }}</span>
													<em>{{ holidayHint(cell.isCn) }}</em>
												</span>
												{{ cell.day }}
											</span>
										</div>
										<div class="cvd-legend">
											<span><i />{{ data.contact.country }}假期</span>
											<span><i class="is-cn" />中国假期</span>
										</div>
									</template>
								</aside>
							</div>
							</div>

							<div v-if="playbook || dualTrack || data.promises.length" class="cvd-cols">
								<!-- 左列 -->
								<div class="cvd-col">
									<section class="cvd-card">
										<div class="cvd-card__head">
											<svg class="cvd-ico" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4S18.3 16.4 19.5 20" /></svg>
											<span class="cvd-card__title">基本信息</span>
											<span class="cvd-card__meta">{{ basicInfoCount }} 项有值</span>
										</div>
										<div v-for="row in basicRows" :key="row.label" class="cvd-kv">
											<div class="cvd-kv__k">{{ row.label }}</div>
											<div class="cvd-kv__v">
												{{ row.value }}<span v-if="row.suffix" class="cvd-dim"> {{ row.suffix }}</span>
											</div>
										</div>
										<button class="cvd-more" @click="showFull = true">
											查看完整信息
											<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
										</button>
									</section>

									<section v-if="dualTrack" class="cvd-card">
										<div class="cvd-card__head">
											<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z" /></svg>
											<span class="cvd-card__title">关系温度</span>
											<span class="cvd-card__meta">{{ insightUpdatedAt }} 更新</span>
										</div>
										<div v-for="track in dualTracks" :key="track.key" class="cvd-temp">
											<div class="cvd-temp__top">
												<span class="cvd-temp__label">{{ track.label }}</span>
												<span
													class="cvd-temp__level"
													:style="{ color: (track.side.score ?? 0) >= 20 ? 'var(--ok)' : 'var(--warn)' }"
												>
													{{ track.side.level }}<template v-if="track.side.score !== null"> · {{ track.side.score }}</template>
												</span>
											</div>
											<div class="cvd-temp__bar">
												<div
													class="cvd-temp__fill"
													:class="(track.side.score ?? 0) >= 20 ? 'cvd-temp__fill--high' : 'cvd-temp__fill--mid'"
													:style="{ width: trackBarWidth(track.side.score) }"
												/>
											</div>
											<div v-if="track.side.note" class="cvd-temp__note">{{ track.side.note }}</div>
										</div>
										<div class="cvd-score">
											<span class="cvd-score__num">{{ openPromises.length }}</span>
											<span class="cvd-score__unit">条待兑现承诺</span>
											<span class="cvd-score__delta">我方 {{ openPromiseCount.ours }} · 对方 {{ openPromiseCount.theirs }}</span>
										</div>
									</section>

									<section v-if="playbook && (playbook.sweet_spots.length > 0 || playbook.taboos.length > 0)" class="cvd-card">
										<div class="cvd-card__head">
											<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M12 3v18M5 8l7-5 7 5" /></svg>
											<span class="cvd-card__title">相处红绿灯</span>
											<span class="cvd-card__meta">有原话依据</span>
										</div>
										<div v-if="playbook.sweet_spots.length" class="cvd-lights__col">
											<h4>可以多做</h4>
											<el-popover v-for="(item, index) in playbook.sweet_spots" :key="`sweet-${index}`" trigger="hover" width="340">
												<template #reference>
													<div class="cvd-lights__item"><span class="cvd-lights__mark">✅</span>{{ item.title }}</div>
												</template>
												<div class="crm-evidence-pop">
													<p>「{{ item.quote }}」</p>
													<span class="crm-muted">{{ item.time ?? "时间未知" }}</span>
												</div>
											</el-popover>
										</div>
										<div v-if="playbook.taboos.length" class="cvd-lights__col">
											<h4>不要做</h4>
											<el-popover v-for="(item, index) in playbook.taboos" :key="`taboo-${index}`" trigger="hover" width="340">
												<template #reference>
													<div class="cvd-lights__item"><span class="cvd-lights__mark">❌</span>{{ item.title }}</div>
												</template>
												<div class="crm-evidence-pop">
													<p>「{{ item.quote }}」</p>
													<span class="crm-muted">{{ item.time ?? "时间未知" }}</span>
												</div>
											</el-popover>
										</div>
										<button class="cvd-more" @click="router.push(`/contacts/${id}/insights`)">
											展开详情
											<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
										</button>
									</section>
								</div>

								<!-- 中列 -->
								<div class="cvd-col">
									<section class="cvd-card">
										<div class="cvd-card__head">
											<svg class="cvd-ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><path d="M12 8v4l2.5 1.8" /></svg>
											<span class="cvd-card__title">人物画像</span>
											<span class="cvd-card__meta">{{ profileCount }} 条 · 更新于 {{ insightUpdatedAt }}</span>
										</div>
										<div v-for="item in profileFeed" :key="item.title" class="cvd-pitem">
											<div class="cvd-pitem__top">
												<span class="cvd-pitem__title">{{ item.title }}</span>
												<span v-if="item.time" class="cvd-pitem__time">{{ shortDate(item.time) }}</span>
											</div>
											<div v-if="item.attribution" class="cvd-pitem__desc">{{ item.attribution }}</div>
											<div v-if="item.confidence !== null" class="cvd-conf">
												<span class="cvd-conf__track"><span class="cvd-conf__fill" :style="{ width: `${item.confidence}%` }" /></span>
												<span class="cvd-conf__num">置信 {{ item.confidence }}%</span>
											</div>
										</div>
										<div v-if="!profileFeed.length" class="cvd-muted">
											还没有画像条目，点「重新研究」或去深度画像页补全。
										</div>
										<button class="cvd-more" @click="router.push(`/contacts/${id}/insights`)">
											展开更多画像
											<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
										</button>
									</section>

									<section class="cvd-card">
										<div class="cvd-card__head">
											<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" /></svg>
											<span class="cvd-card__title">沟通与互动</span>
											<span class="cvd-card__meta">最近 {{ recentActivities.length }} 条</span>
										</div>
										<ul v-if="recentActivities.length" class="cvd-tl">
											<li v-for="activity in recentActivities" :key="activity.id">
												<span class="cvd-tl__ico" :class="activityTone(activity) ? `cvd-tl__ico--${activityTone(activity)}` : ''">
													<svg v-if="activity.kind === 'task'" class="cvd-ico" viewBox="0 0 24 24"><path d="M4 12.5 9 17.5 20 6.5" /></svg>
													<svg v-else-if="activity.kind === 'chat_log'" class="cvd-ico" viewBox="0 0 24 24"><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5" /></svg>
													<svg v-else class="cvd-ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
												</span>
												<div class="cvd-tl__body">
													<div class="cvd-tl__title">{{ activity.title }}</div>
													<div class="cvd-tl__time">{{ formatDateTime(activity.createdAt) }}</div>
												</div>
											</li>
										</ul>
										<div v-else class="cvd-muted">还没有活动记录。</div>
										<button class="cvd-more" @click="goSection('timeline')">
											查看全部
											<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
										</button>
									</section>
								</div>

								<!-- 右列：下一步建议（带兑现交互）+ 行为记录 -->
								<div class="cvd-col">
									<section class="cvd-card">
										<div class="cvd-card__head">
											<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M12 3l1.9 4.9L19 9.5l-4 3.6.9 5.4L12 15.8 8.1 18.5l.9-5.4-4-3.6 5.1-1.6z" /></svg>
											<span class="cvd-card__title">下一步建议</span>
										</div>
										<el-alert v-if="promiseError" type="error" :closable="false" show-icon :title="promiseError" />

										<div v-for="group in promiseGroups" :key="group.direction" class="cvd-sug">
											<div class="cvd-sug__label">
												{{ group.label }}
												<span class="cvd-sug__count">{{ group.items.length }} 条</span>
											</div>
											<div v-for="item in group.items" :key="item.id" class="cvd-sug__item">
												<el-popover trigger="hover" width="340">
													<template #reference>
														<div class="cvd-sug__title">{{ item.title }}</div>
													</template>
													<div class="crm-evidence-pop">
														<p v-for="(ev, index) in item.evidence" :key="index">「{{ ev.quote }}」</p>
														<span class="crm-muted">{{ item.evidence[0]?.time ?? "时间未知" }}</span>
													</div>
												</el-popover>
												<div v-if="item.dueHint" class="cvd-sug__note">{{ item.dueHint }}</div>
												<div class="cvd-sug__ops">
													<el-popconfirm
														:title="`确认「${item.title}」${group.fulfilledLabel}？确认后会从待办移到行为记录。`"
														confirm-button-text="确认"
														cancel-button-text="再想想"
														@confirm="closePromiseItem(item, 'fulfilled')"
													>
														<template #reference>
															<button class="cvd-sug__btn cvd-sug__btn--main" :disabled="promiseBusy === item.id">
																{{ group.fulfilledLabel }}
															</button>
														</template>
													</el-popconfirm>
													<el-popconfirm
														title="标记为不兑现？它会被移入行为记录。"
														confirm-button-text="确认"
														cancel-button-text="再想想"
														@confirm="closePromiseItem(item, 'cancelled')"
													>
														<template #reference>
															<button class="cvd-sug__btn cvd-sug__btn--ghost" :disabled="promiseBusy === item.id">
																取消
															</button>
														</template>
													</el-popconfirm>
												</div>
											</div>
										</div>

										<div v-if="!promiseGroups.length" class="cvd-sug">
											<div class="cvd-sug__label">暂无待办承诺</div>
											<div class="cvd-sug__empty">当前没有挂着未兑现的承诺；已闭环的都在下方「行为记录」里。</div>
										</div>

										<div v-if="smallTalk?.ready_to_use_icebreaker" class="cvd-ice">
											<div class="cvd-ice__head">
												<span class="cvd-ice__label">破冰话术</span>
												<button class="cvd-ice__copy" @click="copyIcebreaker">
													{{ icebreakerCopied ? "已复制" : "复制" }}
												</button>
											</div>
											<div class="cvd-ice__text">{{ smallTalk.ready_to_use_icebreaker.zh }}</div>
										</div>
									</section>

									<section class="cvd-card">
										<div class="cvd-card__head">
											<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h11M4 18h7" /></svg>
											<span class="cvd-card__title">行为记录</span>
											<span class="cvd-card__meta">最近 {{ behaviors.length }} 条</span>
										</div>
										<div v-for="row in behaviors" :key="row.key" class="cvd-beat">
											<div class="cvd-beat__body">
												<div class="cvd-beat__title">{{ row.title }}</div>
												<div class="cvd-beat__time">{{ row.time }}</div>
											</div>
											<span class="cvd-pill" :class="row.tone === 'ok' ? 'cvd-pill--ok' : 'cvd-pill--done'">{{ row.pill }}</span>
										</div>
										<div v-if="!behaviors.length" class="cvd-muted">还没有已完成的任务或已闭环的承诺。</div>
									</section>
								</div>
							</div>

							<el-empty
								v-else-if="!playbook && !dualTrack"
								description="还没有关系洞察：导入聊天记录或点「重新研究」后，这里会出现人物白描与相处说明书。"
								:image-size="70"
							/>
						</div>
					</template>

					<template v-else-if="section === 'deals'">
						<el-empty v-if="data.deals.length === 0" description="还没有关联商机" :image-size="70" />
						<div v-for="deal in data.deals" :key="deal.id" class="crm-card cvd-deal-row">
							<div>
								<NuxtLink :to="`/deals/${deal.id}`" class="crm-link">{{ deal.name }}</NuxtLink>
								<div class="crm-muted">{{ stageDuration(deal.stageChangedAt) }}</div>
							</div>
							<el-select
								:model-value="deal.stage"
								size="small"
								style="width: 120px"
								@change="(value: string) => changeStage(deal.id, value)"
							>
								<el-option v-for="stage in DEAL_STAGES" :key="stage" :label="stage" :value="stage" />
							</el-select>
						</div>
					</template>

				<template v-else-if="section === 'fields'">
					<FieldProposals
						:fields="fieldDefs?.fields ?? []"
						:record-id="id"
						:busy="factBusy"
						@decide="decideField"
					/>
					<FactSuggestions
						:facts="data.facts"
						:labels="fieldLabels"
						:busy="factBusy"
						@decide="decideFact"
					/>
				</template>

				<template v-else-if="section === 'timeline'">
					<el-empty v-if="data.activities.length === 0" description="还没有活动" />
					<div v-for="activity in data.activities" :key="activity.id" class="crm-timeline-item">
						<div>
							<el-tag size="small" effect="plain">{{ ACTIVITY_KIND_LABELS[activity.kind] }}</el-tag>
							<span class="crm-activity-title">{{ activity.title }}</span>
							<el-button
								v-if="activity.kind === 'chat_log'"
								link
								type="primary"
								size="small"
								@click="goSection('archive')"
							>
								看留底
							</el-button>
						</div>
						<div v-if="activity.body" class="crm-quote">{{ activity.body }}</div>
						<div class="crm-muted">
							{{ formatDateTime(activity.createdAt) }}
							<template v-if="activity.dueAt"> · 截止 {{ formatDateTime(activity.dueAt) }}</template>
						</div>
					</div>
				</template>

				<template v-else-if="section === 'archive'">

					<p class="crm-muted crm-archive__hint">
						历次导入的聊天原文，只读，不可编辑。原文存在会话记录里，不进备注、也不进活动正文 ——
						想回看当时聊到哪、隔了多久，从这里进。
					</p>

					<el-alert v-if="archiveError" type="error" :closable="false" show-icon :title="archiveError" />

					<el-empty v-if="data.archives.length === 0" description="还没有导入过聊天记录" />

					<div v-for="item in data.archives" :key="item.conversationId" class="crm-card crm-archive">
						<div class="crm-spread">
							<strong class="crm-archive__title">{{ item.title }}</strong>
							<el-button
								size="small"
								:loading="archiveBusy === item.conversationId"
								@click="toggleArchive(item)"
							>
								{{ openedArchive === item.conversationId ? "收起原文" : "查看原文" }}
							</el-button>
						</div>
						<div class="crm-muted crm-archive__meta">导入于 {{ formatDateTime(item.importedAt) }}</div>
						<p v-if="item.summary" class="crm-archive__summary">{{ item.summary }}</p>
						<pre v-if="openedArchive === item.conversationId" class="crm-archive__text">{{ archiveText }}</pre>
					</div>
				</template>

				<template v-else-if="section === 'behavior'">
					<div class="cvd">
						<section class="cvd-card cvd-panel">
							<div class="cvd-card__head">
								<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h11M4 18h7" /></svg>
								<span class="cvd-card__title">行为记录</span>
								<span class="cvd-card__meta">共 {{ allBehaviors.length }} 条</span>
							</div>
							<div v-for="row in allBehaviors" :key="row.key" class="cvd-beat">
								<div class="cvd-beat__body">
									<div class="cvd-beat__title">{{ row.title }}</div>
									<div class="cvd-beat__time">{{ row.time }}</div>
								</div>
								<span class="cvd-pill" :class="row.tone === 'ok' ? 'cvd-pill--ok' : 'cvd-pill--done'">{{ row.pill }}</span>
							</div>
							<div v-if="!allBehaviors.length" class="cvd-muted">还没有已完成的任务或已闭环的承诺。</div>
						</section>
					</div>
				</template>

				<template v-else-if="section === 'promises'">
					<div class="cvd">
						<section class="cvd-card cvd-panel">
							<div class="cvd-card__head">
								<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M6 4h12v17l-6-3.5L6 21z" /><path d="M9.5 9.5l1.8 1.8 3.2-3.4" /></svg>
								<span class="cvd-card__title">承诺账本</span>
								<span class="cvd-card__meta">{{ openPromises.length }} 条待兑现 · {{ closedPromises.length }} 条已闭环</span>
							</div>
							<el-alert v-if="promiseError" type="error" :closable="false" show-icon :title="promiseError" />

							<div v-for="group in promiseGroups" :key="group.direction" class="cvd-sug">
								<div class="cvd-sug__label">
									{{ group.label }}
									<span class="cvd-sug__count">{{ group.items.length }} 条</span>
								</div>
								<div v-for="item in group.items" :key="item.id" class="cvd-sug__item">
									<el-popover trigger="hover" width="340">
										<template #reference>
											<div class="cvd-sug__title">{{ item.title }}</div>
										</template>
										<div class="crm-evidence-pop">
											<p v-for="(ev, index) in item.evidence" :key="index">「{{ ev.quote }}」</p>
											<span class="crm-muted">{{ item.evidence[0]?.time ?? "时间未知" }}</span>
										</div>
									</el-popover>
									<div v-if="item.dueHint" class="cvd-sug__note">{{ item.dueHint }}</div>
									<div class="cvd-sug__ops">
										<el-popconfirm
											:title="`确认「${item.title}」${group.fulfilledLabel}？确认后会从待办移到行为记录。`"
											confirm-button-text="确认"
											cancel-button-text="再想想"
											@confirm="closePromiseItem(item, 'fulfilled')"
										>
											<template #reference>
												<button class="cvd-sug__btn cvd-sug__btn--main" :disabled="promiseBusy === item.id">
													{{ group.fulfilledLabel }}
												</button>
											</template>
										</el-popconfirm>
										<el-popconfirm
											title="标记为不兑现？它会被移入行为记录。"
											confirm-button-text="确认"
											cancel-button-text="再想想"
											@confirm="closePromiseItem(item, 'cancelled')"
										>
											<template #reference>
												<button class="cvd-sug__btn cvd-sug__btn--ghost" :disabled="promiseBusy === item.id">
													取消
												</button>
											</template>
										</el-popconfirm>
									</div>
								</div>
							</div>

							<div v-if="!promiseGroups.length" class="cvd-sug">
								<div class="cvd-sug__label">暂无待办承诺</div>
								<div class="cvd-sug__empty">当前没有挂着未兑现的承诺；已闭环的都在下方。</div>
							</div>
						</section>

						<section class="cvd-card cvd-panel">
							<div class="cvd-card__head">
								<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>
								<span class="cvd-card__title">已闭环</span>
								<span class="cvd-card__meta">{{ closedPromises.length }} 条</span>
							</div>
							<div v-for="row in closedPromises" :key="row.id" class="cvd-beat">
								<div class="cvd-beat__body">
									<div class="cvd-beat__title">{{ row.title }}</div>
									<div class="cvd-beat__time">
										{{ row.closedAt ? `${formatDate(row.closedAt)} · ${PROMISE_STATUS_LABELS[row.status]}` : PROMISE_STATUS_LABELS[row.status] }}
									</div>
								</div>
								<span class="cvd-pill" :class="row.status === 'fulfilled' ? 'cvd-pill--ok' : 'cvd-pill--done'">
									{{ row.status === "fulfilled" ? "已兑现" : "已关闭" }}
								</span>
							</div>
							<div v-if="!closedPromises.length" class="cvd-muted">还没有闭环的承诺。</div>
						</section>
					</div>
				</template>

				<template v-else-if="section === 'agent'">
					<AgentChat :contact-id="id" />
				</template>
				</div>
			</div>

			<el-dialog v-model="showEdit" title="编辑联系人" width="520">
				<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
				<ContactForm
					:contact="data.contact"
					:submitting="submitting"
					@submit="editContact"
					@cancel="showEdit = false"
				/>
			</el-dialog>

			<el-dialog v-model="showNote" title="记一条活动" width="520">
				<el-input v-model="noteTitle" placeholder="标题，例如：微信名片原文" maxlength="191" />
				<el-input
					v-model="noteBody"
					class="crm-note-body"
					type="textarea"
					:rows="5"
					placeholder="把客户原文、聊天记录、跟进情况贴在这里。它会进活动时间线，后台研究也从这里取证。"
				/>
				<template #footer>
					<el-button @click="showNote = false">取消</el-button>
					<el-button
						type="primary"
						:loading="noteSaving"
						:disabled="!noteTitle.trim()"
						@click="submitNote"
					>
						保存活动
					</el-button>
				</template>
			</el-dialog>

			<el-dialog v-model="showFull" title="完整联系人信息" width="640">
				<el-descriptions :column="1" border>
					<el-descriptions-item label="邮箱">{{ data.contact.email ?? "—" }}</el-descriptions-item>
					<el-descriptions-item label="电话">{{ data.contact.phone ?? "—" }}</el-descriptions-item>
					<el-descriptions-item label="微信号">{{ data.contact.wechatId ?? "—" }}</el-descriptions-item>
					<el-descriptions-item label="地址">
						<span>{{ data.contact.address ?? "—" }}</span>
						<el-button
							v-if="data.contact.address"
							link
							type="primary"
							size="small"
							class="crm-copy"
							@click="copyAddress"
						>
							{{ addressCopied ? "已复制" : "复制" }}
						</el-button>
					</el-descriptions-item>
					<el-descriptions-item label="国家">{{ data.contact.country ?? "—" }}</el-descriptions-item>
					<el-descriptions-item label="邮编">{{ data.contact.postalCode ?? "—" }}</el-descriptions-item>
					<el-descriptions-item label="客户等级">
						<el-tag v-if="data.contact.customerGrade" size="small" type="warning" effect="plain">
							{{ data.contact.customerGrade }}
						</el-tag>
						<span v-else>—</span>
					</el-descriptions-item>
					<el-descriptions-item label="业务角色">{{ data.contact.businessRole ?? "—" }}</el-descriptions-item>
					<el-descriptions-item label="关系维护">
						<el-tag
							v-if="data.contact.relationshipState"
							size="small"
							effect="plain"
							:type="data.contact.relationshipState === RELATIONSHIP_REPAIR ? 'danger' : 'info'"
						>
							{{ data.contact.relationshipState }}
						</el-tag>
						<span v-else class="crm-muted">默认</span>
					</el-descriptions-item>
					<el-descriptions-item v-if="data.contact.repairNote" label="修复说明">
						<span class="crm-pre">{{ data.contact.repairNote }}</span>
					</el-descriptions-item>
					<el-descriptions-item label="领英">{{ data.contact.linkedin ?? "—" }}</el-descriptions-item>
					<el-descriptions-item label="GitHub">{{ data.contact.github ?? "—" }}</el-descriptions-item>
					<el-descriptions-item label="最近研究">
						{{ data.contact.lastResearchedAt ? formatDateTime(data.contact.lastResearchedAt) : "尚未研究" }}
					</el-descriptions-item>
					<el-descriptions-item label="备注">
						<span class="crm-pre">{{ data.contact.notes ?? "—" }}</span>
					</el-descriptions-item>
					<el-descriptions-item v-for="fact in customFacts" :key="fact.id" :label="fieldLabels[fact.field] ?? fact.field">
						{{ fact.value }}
					</el-descriptions-item>
				</el-descriptions>
			</el-dialog>
		</template>
	</div>
</template>

<style scoped>
.crm-link {
	color: var(--crm-brand);
	text-decoration: none;
	font-weight: 500;
}

.crm-pre {
	white-space: pre-wrap;
}

.crm-copy {
	margin-left: 8px;
}

.crm-evidence-pop p {
	margin: 0 0 4px;
	line-height: 1.7;
	font-size: 13px;
}

.crm-note-body {
	margin: 8px 0;
}

.crm-activity-title {
	margin-left: 6px;
}

.crm-archive__hint {
	margin: 0 0 12px;
	line-height: 1.7;
}

.crm-archive {
	margin-bottom: 12px;
}

.crm-archive__title {
	font-size: 14px;
}

.crm-archive__meta {
	font-size: 12px;
	margin-top: 4px;
}

.crm-archive__summary {
	margin: 8px 0 0;
	line-height: 1.7;
	font-size: 13px;
}

.crm-archive__text {
	margin: 12px 0 0;
	padding: 12px;
	max-height: 460px;
	overflow: auto;
	background: var(--crm-surface);
	border-radius: 6px;
	font-size: 12px;
	line-height: 1.7;
	white-space: pre-wrap;
	word-break: break-word;
}
</style>
