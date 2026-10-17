<script setup lang="ts">
import {
	ACTIVITY_KIND_LABELS,
	COUNTERPART_TYPE_LABELS,
	DEAL_STAGES,
	FACT_FIELDS,
	FACT_FIELD_LABELS,
	RELATIONSHIP_REPAIR,
	SPECTRUM_AXES,
} from "~/types/domain";
import type { IntakeArchive, PlaybookPayload, DualTrackPayload, PromiseItem } from "~/types/domain";
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

const activeTab = ref("overview");
const showEdit = ref(false);
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

/** 破冰话术一键复制（中英两行一起进剪贴板）。内网 http 下 copyText 自带兜底。 */
const icebreakerCopied = ref(false);
let icebreakerTimer: ReturnType<typeof setTimeout> | null = null;

async function copyIcebreaker() {
	const icebreaker = smallTalk.value?.ready_to_use_icebreaker;
	const text = icebreaker ? [icebreaker.zh, icebreaker.en].filter(Boolean).join("\n") : "";

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
			label: direction === "ours" ? "我方欠对方的（待兑现）" : "对方许我方的（待收割）",
			items: openPromises.value.filter((item) => item.direction === direction),
		}))
		.filter((group) => group.items.length > 0),
);

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

watch(activeTab, async (tab) => {
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

async function addNote() {
	if (!noteTitle.value.trim()) return;

	await api.createActivity({
		kind: "note",
		title: noteTitle.value,
		body: noteBody.value || null,
		contactId: id.value,
		companyId: data.value?.contact.companyId ?? null,
	});

	noteTitle.value = "";
	noteBody.value = "";
	await refresh();
}

async function changeStage(dealId: string, stage: string) {
	await api.changeDealStage(dealId, stage);
	await refresh();
}
</script>

<template>
	<div class="crm-page">
		<div v-if="!data" class="crm-card">
			<el-empty description="联系人不存在或已被归档" />
		</div>

		<template v-else>
			<div class="crm-spread crm-section">
				<div>
					<h1 class="crm-title">
						{{ personName(data.contact) }}
						<el-popconfirm
							v-if="data.researching"
							title="终止这项后台研究？"
							confirm-button-text="终止"
							cancel-button-text="再等等"
							@confirm="cancelResearch"
						>
							<template #reference>
								<el-tooltip content="研究超过几分钟没结束多半是卡住了，点这里终止；之后可再点「重新研究」重跑。" placement="top">
									<el-link type="warning" :underline="false">正在研究，点此终止</el-link>
								</el-tooltip>
							</template>
						</el-popconfirm>
					</h1>
					<div class="crm-muted">
						{{ data.contact.title ?? "职位未知" }}
						<template v-if="data.company">
							· <NuxtLink :to="`/companies/${data.company.id}`" class="crm-link">{{ data.company.name }}</NuxtLink>
						</template>
					</div>
				</div>
				<div class="crm-row">
					<el-button :loading="researchBusy" @click="research">重新研究</el-button>
					<el-button @click="showEdit = true">编辑</el-button>
					<el-popconfirm title="归档后不在列表显示，确定吗？" @confirm="archive">
						<template #reference>
							<el-button type="danger" plain>归档</el-button>
						</template>
					</el-popconfirm>
				</div>
			</div>

			<el-tabs v-model="activeTab">
				<el-tab-pane label="概览" name="overview">
					<!-- 顶栏：人物白描 + 短标签。旧数据没有白描时给补全入口。 -->
					<section v-if="playbook" class="crm-card crm-profile-head crm-section">
						<div class="crm-spread crm-profile-head__top">
							<h2 class="crm-section__title">人物白描</h2>
							<el-tag size="small" effect="plain">{{ COUNTERPART_TYPE_LABELS[playbook.counterpart_type] }}</el-tag>
						</div>
						<p v-if="playbook.executive_summary" class="crm-executive">{{ playbook.executive_summary }}</p>
						<p v-else class="crm-executive crm-executive--empty">
							还没有人物白描。点右上角「重新研究」，智能体会补一段一针见血的总括。
						</p>
						<div v-if="playbook.short_tags.length" class="crm-short-tags">
							<span v-for="tag in playbook.short_tags" :key="tag" class="crm-short-tag">#{{ tag }}</span>
						</div>
					</section>

					<div
						v-if="deepGroups.length || dualTrack || data.promises.length > 0"
						class="crm-columns crm-section"
					>
						<!-- 左栏：深度画像与心理归因 -->
						<div class="crm-col">
							<section v-if="deepGroups.length" class="crm-card">
								<h2 class="crm-section__title">深度画像与心理归因</h2>
								<p class="crm-muted crm-card__hint">表象背后的心理动机。置信度越高越接近铁律；「▶ 原话依据」可展开，悬停也可预览。</p>
								<div v-for="group in deepGroups" :key="group.key" class="crm-deep__group">
									<div class="crm-deep__label">
										<span class="crm-deep__dot" :style="{ background: group.dot }" />
										{{ group.label }}
									</div>
									<article v-for="(item, index) in group.items" :key="index" class="crm-deep">
										<header class="crm-deep__head">
											<strong class="crm-deep__title">{{ item.title }}</strong>
											<span v-if="item.confidence !== null" class="crm-deep__conf">
												<span class="crm-deep__conf-text">置信 {{ item.confidence }}%</span>
												<span class="crm-deep__conf-bar">
													<i :style="{ width: `${item.confidence}%` }" />
												</span>
											</span>
										</header>
										<p v-if="item.attribution" class="crm-deep__attr">{{ item.attribution }}</p>
										<el-popover trigger="hover" width="340">
											<template #reference>
												<button
													type="button"
													class="crm-deep__toggle"
													@click="toggleEvidence(`${group.key}-${index}`)"
												>
													{{ expandedEvidence.has(`${group.key}-${index}`) ? "▾" : "▶" }} 原话依据
												</button>
											</template>
											<div class="crm-evidence-pop">
												<p>「{{ item.quote }}」</p>
												<span class="crm-muted">{{ item.time ?? "时间未知" }}</span>
											</div>
										</el-popover>
										<div v-if="expandedEvidence.has(`${group.key}-${index}`)" class="crm-deep__quote">
											「{{ item.quote }}」<span class="crm-muted">{{ item.time ?? "时间未知" }}</span>
										</div>
									</article>
								</div>
							</section>
						</div>

						<!-- 中栏：双轨温度计 + 性格光谱 + 家常弹药库 -->
						<div class="crm-col">
							<section v-if="dualTrack" class="crm-card crm-dual-track">
								<h2 class="crm-section__title">关系双轨温度</h2>
								<div v-for="track in dualTracks" :key="track.key" class="crm-dual-track__row">
									<div class="crm-dual-track__head">
										<strong>{{ track.label }}</strong>
										<el-tag size="small" :type="(track.side.score ?? 0) >= 0 ? 'success' : 'danger'" effect="plain">
											{{ track.side.level }}
										</el-tag>
									</div>
									<div class="crm-dual-track__bar">
										<div class="crm-dual-track__fill" :style="{ width: trackBarWidth(track.side.score) }" />
									</div>
									<el-popover v-if="track.side.note" trigger="hover" width="340">
										<template #reference>
											<div class="crm-muted crm-dual-track__note">{{ track.side.note }}</div>
										</template>
										<div class="crm-evidence-pop">
											<p v-if="track.side.quote">「{{ track.side.quote }}」</p>
											<span class="crm-muted">{{ track.side.time ?? "时间未知" }}</span>
										</div>
									</el-popover>
									<div v-else class="crm-muted crm-dual-track__note">—</div>
								</div>
							</section>

							<section v-if="spectrumAxes.length" class="crm-card">
								<h2 class="crm-section__title">三维性格光谱</h2>
								<div v-for="axis in spectrumAxes" :key="axis.key" class="crm-spec">
									<div class="crm-spec__labels">
										<span>{{ axis.left }}</span>
										<span class="crm-spec__dim">{{ axis.label }}</span>
										<span>{{ axis.right }}</span>
									</div>
									<div class="crm-spec__track">
										<span class="crm-spec__dot" :style="{ left: `${axis.side.score}%` }" />
									</div>
									<div v-if="axis.side.note" class="crm-muted crm-spec__note">{{ axis.side.note }}</div>
								</div>
							</section>

							<section v-if="smallTalk" class="crm-card crm-smalltalk">
								<h2 class="crm-section__title">☕ 破冰与家常弹药库</h2>
								<p v-if="smallTalk.strategy_advice" class="crm-smalltalk__advice">
									{{ smallTalk.strategy_advice }}
								</p>
								<ul v-if="smallTalk.personal_hooks.length" class="crm-smalltalk__hooks">
									<li v-for="(hook, index) in smallTalk.personal_hooks" :key="index">
										<el-popover trigger="hover" width="340">
											<template #reference>
												<span class="crm-smalltalk__hook">
													<span class="crm-smalltalk__cat">{{ hook.category }}</span>
													{{ hook.detail }}
												</span>
											</template>
											<div class="crm-evidence-pop">
												<p>「{{ hook.quote }}」</p>
												<span class="crm-muted">{{ hook.time ?? "时间未知" }}</span>
											</div>
										</el-popover>
									</li>
								</ul>
								<div v-if="smallTalk.ready_to_use_icebreaker" class="crm-icebreaker">
									<div class="crm-icebreaker__text">
										<p>{{ smallTalk.ready_to_use_icebreaker.zh }}</p>
										<p v-if="smallTalk.ready_to_use_icebreaker.en" class="crm-muted">
											{{ smallTalk.ready_to_use_icebreaker.en }}
										</p>
									</div>
									<el-button
										size="small"
										plain
										:type="icebreakerCopied ? 'success' : 'primary'"
										@click="copyIcebreaker"
									>
										{{ icebreakerCopied ? "已复制" : "一键复制" }}
									</el-button>
								</div>
							</section>
						</div>

						<!-- 右栏：双向承诺账本 + 相处红绿灯 -->
						<div class="crm-col">
							<section v-if="data.promises.length > 0" class="crm-card crm-ledger">
								<h2 class="crm-section__title">双向承诺账本</h2>
								<el-alert v-if="promiseError" type="error" :closable="false" show-icon :title="promiseError" />
								<div v-for="group in promiseGroups" :key="group.direction" class="crm-ledger__group">
									<div class="crm-ledger__label">{{ group.label }}</div>
									<div v-for="item in group.items" :key="item.id" class="crm-ledger__item">
										<el-popover trigger="hover" width="340">
											<template #reference>
												<div class="crm-ledger__title">
													{{ item.title }}
													<el-tag v-if="item.dueHint" size="small" effect="plain">{{ item.dueHint }}</el-tag>
												</div>
											</template>
											<div class="crm-evidence-pop">
												<p v-for="(ev, index) in item.evidence" :key="index">「{{ ev.quote }}」</p>
												<span class="crm-muted">{{ item.evidence[0]?.time ?? "时间未知" }}</span>
											</div>
										</el-popover>
										<div class="crm-row">
											<el-button
												size="small"
												type="primary"
												link
												:loading="promiseBusy === item.id"
												@click="closePromiseItem(item, 'fulfilled')"
											>
												已兑现
											</el-button>
											<el-button
												size="small"
												link
												type="danger"
												:loading="promiseBusy === item.id"
												@click="closePromiseItem(item, 'cancelled')"
											>
												不兑现
											</el-button>
										</div>
									</div>
								</div>
								<div v-if="promiseGroups.length === 0" class="crm-muted crm-ledger__label">
									没有待处理的承诺（历史 {{ data.promises.length }} 条已闭环）。
								</div>
							</section>

							<section
								v-if="playbook && (playbook.sweet_spots.length > 0 || playbook.taboos.length > 0)"
								class="crm-card"
							>
								<h2 class="crm-section__title">相处红绿灯</h2>
								<ul class="crm-lights">
									<li v-for="(item, index) in playbook.sweet_spots" :key="`sweet-${index}`">
										<el-popover trigger="hover" width="340">
											<template #reference>
												<span class="crm-lights__item">
													<span class="crm-lights__mark">✅</span>{{ item.title }}
												</span>
											</template>
											<div class="crm-evidence-pop">
												<p>「{{ item.quote }}」</p>
												<span class="crm-muted">{{ item.time ?? "时间未知" }}</span>
											</div>
										</el-popover>
									</li>
									<li v-for="(item, index) in playbook.taboos" :key="`taboo-${index}`">
										<el-popover trigger="hover" width="340">
											<template #reference>
												<span class="crm-lights__item">
													<span class="crm-lights__mark">❌</span>{{ item.title }}
												</span>
											</template>
											<div class="crm-evidence-pop">
												<p>「{{ item.quote }}」</p>
												<span class="crm-muted">{{ item.time ?? "时间未知" }}</span>
											</div>
										</el-popover>
									</li>
								</ul>
							</section>
						</div>
					</div>

					<el-empty
						v-else-if="!playbook && !dualTrack"
						description="还没有关系洞察：导入聊天记录或点「重新研究」后，这里会出现人物白描与相处说明书。"
						:image-size="70"
					/>

					<div class="crm-grid">
						<section class="crm-card">
							<h2 class="crm-section__title">基本信息</h2>
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
						</section>

						<section class="crm-card">
							<h2 class="crm-section__title">相关商机</h2>
							<el-empty v-if="data.deals.length === 0" description="还没有关联商机" :image-size="60" />
							<div v-for="deal in data.deals" :key="deal.id" class="crm-timeline-item crm-spread">
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
						</section>

						<section class="crm-card">
							<h2 class="crm-section__title">记一条活动</h2>
							<el-input v-model="noteTitle" placeholder="标题，例如：微信名片原文" maxlength="191" />
							<el-input
								v-model="noteBody"
								class="crm-note-body"
								type="textarea"
								:rows="4"
								placeholder="把客户原文、聊天记录、跟进情况贴在这里。它会进活动时间线，后台研究也从这里取证。"
							/>
							<el-button type="primary" @click="addNote">保存活动</el-button>
						</section>
					</div>
				</el-tab-pane>

				<el-tab-pane name="suggestions">
					<template #label>
						字段建议
						<el-badge
							v-if="
								data.facts.filter((fact) => fact.status === 'proposed').length +
									(fieldDefs?.fields ?? []).filter(
										(field) =>
											field.status === 'proposed' &&
											(!field.sampleRef || field.sampleRef === id),
									).length >
								0
							"
							:value="
								data.facts.filter((fact) => fact.status === 'proposed').length +
								(fieldDefs?.fields ?? []).filter(
									(field) =>
										field.status === 'proposed' &&
										(!field.sampleRef || field.sampleRef === id),
								).length
							"
						/>
					</template>
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
				</el-tab-pane>

				<el-tab-pane label="活动时间线" name="timeline">
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
								@click="activeTab = 'archive'"
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
				</el-tab-pane>

				<el-tab-pane name="archive">
					<template #label>
						聊天留底
						<el-badge v-if="unreadArchives > 0" :value="unreadArchives" />
					</template>

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
				</el-tab-pane>

				<el-tab-pane label="Agent" name="agent" lazy>
					<AgentChat :contact-id="id" />
				</el-tab-pane>
			</el-tabs>

			<el-dialog v-model="showEdit" title="编辑联系人" width="520">
				<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />
				<ContactForm
					:contact="data.contact"
					:submitting="submitting"
					@submit="editContact"
					@cancel="showEdit = false"
				/>
			</el-dialog>
		</template>
	</div>
</template>

<style scoped>
.crm-title {
	font-size: 20px;
	margin: 0 0 4px;
	display: flex;
	align-items: center;
	gap: 8px;
}

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

.crm-card__hint {
	font-size: 12px;
	margin: 0 0 10px;
}

.crm-evidence-pop p {
	margin: 0 0 4px;
	line-height: 1.7;
	font-size: 13px;
}

/* ===== 顶栏：人物白描 + 短标签 ===== */

.crm-profile-head__top {
	margin-bottom: 8px;
}

.crm-profile-head__top .crm-section__title {
	margin: 0;
}

/* 白描引用块：暖灰米白底，读起来像档案袋封面的一段手写总评。 */
.crm-executive {
	margin: 0;
	padding: 12px 14px;
	background: #faf7f0;
	border: 1px solid #ede5d5;
	border-left: 3px solid #c9b68a;
	border-radius: 6px;
	line-height: 1.8;
	font-size: 14px;
}

.crm-executive--empty {
	color: var(--crm-muted);
	font-size: 13px;
}

.crm-short-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 10px;
}

/* 短标签是 #话题 式的小胶囊：约束在 10 字内，怎么放都不会截断。 */
.crm-short-tag {
	font-size: 12px;
	color: #5b6b5f;
	background: #f2f5f1;
	border: 1px solid #dfe7e0;
	border-radius: 999px;
	padding: 2px 10px;
	white-space: nowrap;
}

/* ===== 三栏布局 ===== */

.crm-columns {
	display: grid;
	grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1fr);
	gap: 16px;
	align-items: start;
}

.crm-col {
	display: flex;
	flex-direction: column;
	gap: 16px;
	min-width: 0;
}

/* ===== 左栏：深度归因卡片 ===== */

.crm-deep__group {
	margin-bottom: 14px;
}

.crm-deep__group:last-child {
	margin-bottom: 0;
}

.crm-deep__label {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	color: var(--crm-muted);
	margin-bottom: 8px;
}

.crm-deep__dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex: none;
}

.crm-deep {
	border: 1px solid var(--crm-line);
	border-radius: 6px;
	background: var(--crm-surface);
	padding: 10px 12px;
	margin-bottom: 8px;
}

.crm-deep:last-child {
	margin-bottom: 0;
}

.crm-deep__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 10px;
}

.crm-deep__title {
	font-size: 13px;
	line-height: 1.5;
}

.crm-deep__conf {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	flex: none;
}

.crm-deep__conf-text {
	font-size: 11px;
	color: var(--crm-muted);
	white-space: nowrap;
}

.crm-deep__conf-bar {
	width: 44px;
	height: 4px;
	border-radius: 2px;
	background: #e8e8e4;
	overflow: hidden;
	display: inline-block;
}

.crm-deep__conf-bar i {
	display: block;
	height: 100%;
	border-radius: 2px;
	background: var(--crm-brand);
}

.crm-deep__attr {
	margin: 6px 0 0;
	font-size: 12px;
	color: var(--crm-muted);
	line-height: 1.7;
}

.crm-deep__toggle {
	border: none;
	background: none;
	padding: 4px 0 0;
	margin-top: 6px;
	font-size: 12px;
	color: var(--crm-brand);
	cursor: pointer;
}

.crm-deep__toggle:hover {
	text-decoration: underline;
	text-underline-offset: 3px;
}

.crm-deep__quote {
	margin-top: 6px;
	padding: 8px 10px;
	border-left: 3px solid var(--crm-line);
	background: #fff;
	border-radius: 0 4px 4px 0;
	font-size: 12px;
	color: var(--crm-muted);
	line-height: 1.7;
	word-break: break-word;
}

/* ===== 中栏：性格光谱条 ===== */

.crm-spec {
	margin-bottom: 14px;
}

.crm-spec:last-child {
	margin-bottom: 0;
}

.crm-spec__labels {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	gap: 8px;
	font-size: 12px;
	color: var(--crm-ink);
	margin-bottom: 6px;
}

.crm-spec__dim {
	color: var(--crm-muted);
	font-size: 11px;
}

.crm-spec__track {
	position: relative;
	height: 6px;
	border-radius: 3px;
	background: linear-gradient(90deg, #eef1ee, #e2e8e4);
}

.crm-spec__dot {
	position: absolute;
	top: 50%;
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: var(--crm-brand);
	border: 3px solid #fff;
	box-shadow: 0 0 0 1px var(--crm-line);
	transform: translate(-50%, -50%);
	transition: left 0.2s ease;
}

.crm-spec__note {
	font-size: 12px;
	margin-top: 6px;
}

/* ===== 中栏：家常弹药库 ===== */

.crm-smalltalk__advice {
	margin: 0 0 10px;
	padding: 8px 10px;
	background: #f4f7f2;
	border-left: 3px solid var(--crm-brand);
	border-radius: 0 4px 4px 0;
	font-size: 12.5px;
	line-height: 1.7;
}

.crm-smalltalk__hooks {
	list-style: none;
	margin: 0 0 10px;
	padding: 0;
}

.crm-smalltalk__hooks li {
	padding: 5px 0;
	border-bottom: 1px dashed var(--crm-line);
	font-size: 12.5px;
	line-height: 1.7;
	cursor: default;
}

.crm-smalltalk__hooks li:last-child {
	border-bottom: none;
}

.crm-smalltalk__cat {
	display: inline-block;
	font-size: 11px;
	color: #6c5b3a;
	background: #f6f1e4;
	border-radius: 3px;
	padding: 0 5px;
	margin-right: 6px;
	white-space: nowrap;
}

.crm-icebreaker {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding: 10px 12px;
	background: #faf7f0;
	border: 1px solid #ede5d5;
	border-radius: 6px;
}

.crm-icebreaker__text {
	min-width: 0;
}

.crm-icebreaker__text p {
	margin: 0;
	font-size: 12.5px;
	line-height: 1.7;
	word-break: break-word;
}

.crm-icebreaker__text p + p {
	margin-top: 4px;
	font-size: 12px;
}

/* ===== 右栏：承诺账本（沿用紧凑样式）与相处红绿灯 ===== */

.crm-ledger__group {
	margin-bottom: 10px;
}

.crm-ledger__label {
	font-size: 12px;
	color: var(--crm-muted);
	margin-bottom: 6px;
}

.crm-ledger__item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 5px 0;
	border-bottom: 1px dashed var(--crm-line);
}

.crm-ledger__item:last-child {
	border-bottom: none;
}

.crm-ledger__title {
	cursor: default;
	font-size: 13px;
	line-height: 1.6;
}

.crm-lights {
	list-style: none;
	margin: 0;
	padding: 0;
}

.crm-lights li {
	padding: 5px 0;
	border-bottom: 1px dashed var(--crm-line);
}

.crm-lights li:last-child {
	border-bottom: none;
}

.crm-lights__item {
	font-size: 13px;
	line-height: 1.7;
	cursor: default;
	word-break: break-word;
}

.crm-lights__mark {
	margin-right: 6px;
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

.crm-dual-track__row {
	margin-bottom: 14px;
}

.crm-dual-track__row:last-child {
	margin-bottom: 0;
}

.crm-dual-track__head {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 6px;
}

.crm-dual-track__bar {
	height: 8px;
	border-radius: 4px;
	background: var(--crm-surface);
	overflow: hidden;
}

.crm-dual-track__fill {
	height: 100%;
	border-radius: 4px;
	background: linear-gradient(90deg, #d94a4a, var(--crm-brand));
}

.crm-dual-track__note {
	font-size: 12px;
	margin-top: 4px;
	cursor: default;
}

@media (max-width: 1080px) {
	.crm-columns {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
