<script setup lang="ts">
import { SPECTRUM_AXES } from "~/types/domain";
import type { DualTrackPayload, InsightItem, PlaybookPayload } from "~/types/domain";
import { copyText } from "~/utils/clipboard";

const api = useApi();
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));

const { data, refresh } = await useAsyncData(`contact-insights-${id.value}`, () =>
	api.contactDetail(id.value),
);

const playbook = computed(() => {
	const insight = data.value?.insights.find((item) => item.kind === "playbook");

	return insight ? (insight.payload as PlaybookPayload) : null;
});

const dualTrack = computed(() => {
	const insight = data.value?.insights.find((item) => item.kind === "dual_track");

	return insight ? (insight.payload as DualTrackPayload) : null;
});

// ===== 洞察流 =====

type GroupKey = "pos" | "risk" | "tag";
type FeedEntry = InsightItem & { group: GroupKey; sortAt: number };

const GROUPS: Array<{ key: GroupKey; label: string; className: string }> = [
	{ key: "pos", label: "商务潜力", className: "pos" },
	{ key: "risk", label: "痛点与防御", className: "risk" },
	{ key: "tag", label: "画像与属性标签", className: "tag" },
];

/** 原话时间形如「2026-10-19 10:29」，解析失败就当 0，排序时沉底。 */
function sortAtOf(time: string | null): number {
	if (!time) return 0;

	const parsed = Date.parse(time.replace(" ", "T"));

	return Number.isNaN(parsed) ? 0 : parsed;
}

const feedGroups = computed(() => {
	const book = playbook.value;

	if (!book) return [];

	const sources: Record<GroupKey, InsightItem[]> = {
		pos: book.business_value ?? [],
		risk: book.pain_points ?? [],
		tag: book.profile ?? [],
	};

	return GROUPS.map((group) => ({
		...group,
		items: sources[group.key].map((item) => ({
			...item,
			group: group.key,
			sortAt: sortAtOf(item.time),
		})) as FeedEntry[],
	})).filter((group) => group.items.length > 0);
});

const totalCount = computed(() => feedGroups.value.reduce((sum, group) => sum + group.items.length, 0));

const filter = ref<"all" | GroupKey>("all");
const sortMode = ref<"confidence" | "time">("confidence");

const visibleGroups = computed(() =>
	feedGroups.value
		.filter((group) => filter.value === "all" || group.key === filter.value)
		.map((group) => ({
			...group,
			items: [...group.items].sort((left, right) =>
				sortMode.value === "confidence"
					? (right.confidence ?? 0) - (left.confidence ?? 0)
					: right.sortAt - left.sortAt,
			),
		})),
);

function toggleSort() {
	sortMode.value = sortMode.value === "confidence" ? "time" : "confidence";
}

// ===== 右栏：光谱 / 双轨 / 破冰 =====

/** 每条光谱一组两端色，点在中间；颜色跟着点靠近的那一端走。 */
const AXIS_COLORS = [
	{ a: "#d99a5b", b: "#6b93cc" },
	{ a: "#cf7d63", b: "#5f9c92" },
	{ a: "#8b84c4", b: "#cf7f96" },
];

const spectrumAxes = computed(() => {
	const spectrums = playbook.value?.personality_spectrums;

	if (!spectrums) return [];

	return SPECTRUM_AXES.map((axis, index) => {
		const side = spectrums[axis.key];
		const color = AXIS_COLORS[index] ?? AXIS_COLORS[0];

		return {
			...axis,
			side,
			style: {
				"--a": color.a,
				"--b": color.b,
				"--at": side.score >= 50 ? color.b : color.a,
			},
		};
	}).filter((axis) => Boolean(axis.side));
});

const dualTracks = computed(() => {
	const track = dualTrack.value;

	if (!track) return [];

	return [
		{ key: "trust", label: "个人信任", side: track.personal_trust },
		{ key: "transaction", label: "事务健康度", side: track.transaction_health },
	];
});

/** -100（很差）到 100（很好）映射成 0-100% 的条宽。 */
function trackBarWidth(score: number | null): string {
	return `${Math.max(0, Math.min(100, ((score ?? 0) + 100) / 2))}%`;
}

const smallTalk = computed(() => playbook.value?.small_talk_playbook ?? null);

const icebreakerCopied = ref(false);
let icebreakerTimer: ReturnType<typeof setTimeout> | null = null;

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

// ===== 头部 =====

const personInitials = computed(() => {
	const words = (data.value?.contact.firstName ?? "").split(/\s+/).filter(Boolean);

	return (
		words
			.slice(0, 2)
			.map((word) => word.charAt(0).toUpperCase())
			.join("") || "—"
	);
});

const updatedAt = computed(() => {
	const insight = data.value?.insights.find((item) => item.kind === "playbook") ?? data.value?.insights[0];

	return insight ? formatDate(insight.createdAt) : "尚未研究";
});

const researchBusy = ref(false);

async function research() {
	researchBusy.value = true;

	try {
		await api.research("contact", id.value);
		await refresh();
	} finally {
		researchBusy.value = false;
	}
}
</script>

<template>
	<div class="crm-page">
		<div v-if="!data" class="crm-card">
			<el-empty description="联系人不存在或已被归档" />
		</div>

		<div v-else class="cvd">
			<button class="cvd-backline" @click="router.push(`/contacts/${id}`)">
				<svg class="cvd-ico" viewBox="0 0 24 24" style="width: 13px; height: 13px"><path d="M15 6l-6 6 6 6" /></svg>
				返回概览
			</button>

			<div class="cvd-head" style="margin-bottom: 13px">
				<div class="cvd-avatar">{{ personInitials }}</div>
				<div class="cvd-head__main">
					<div class="cvd-head__name">
						<h1>{{ personName(data.contact) }}</h1>
						<span class="cvd-chip cvd-chip--plain">深度画像</span>
					</div>
					<div class="cvd-head__meta">
						<span>{{ totalCount }} 条画像 · {{ dualTracks.length }} 条双轨 · {{ spectrumAxes.length }} 维性格光谱</span>
						<span class="cvd-sep">·</span>
						<span>最近更新 {{ updatedAt }}</span>
						<span v-if="data.researching" class="cvd-sep">·</span>
						<span v-if="data.researching">正在后台研究</span>
					</div>
				</div>
				<div class="cvd-head__actions">
					<button class="cvd-btn" :class="{ 'is-on': sortMode === 'confidence' }" @click="toggleSort">
						{{ sortMode === "confidence" ? "按置信度排序" : "按更新时间排序" }}
					</button>
					<button class="cvd-btn cvd-btn--primary" :disabled="researchBusy" @click="research">
						{{ researchBusy ? "研究中…" : "重新研究" }}
					</button>
				</div>
			</div>

			<div v-if="playbook" class="cvd-detail-grid">
				<!-- 左：可无限追加的洞察流 -->
				<div class="cvd-feed">
					<div class="cvd-feed__head">
						<div>
							<div class="cvd-feed__title">心理归因与画像条目</div>
							<div class="cvd-feed__sub">
								共 {{ totalCount }} 条 · 分 {{ feedGroups.length }} 组 · 每条都可追溯到原话
							</div>
						</div>
					</div>

					<div class="cvd-chips">
						<button class="cvd-fchip" :class="{ 'is-on': filter === 'all' }" @click="filter = 'all'">
							全部<span class="cvd-fchip__n">{{ totalCount }}</span>
						</button>
						<button
							v-for="group in feedGroups"
							:key="group.key"
							class="cvd-fchip"
							:class="{ 'is-on': filter === group.key }"
							@click="filter = group.key"
						>
							{{ group.label }}<span class="cvd-fchip__n">{{ group.items.length }}</span>
						</button>
					</div>

					<section
						v-for="group in visibleGroups"
						:key="group.key"
						class="cvd-group-card"
						:class="`cvd-group--${group.className}`"
					>
						<div class="cvd-group-card__head">
							<span class="cvd-group__head" :class="`cvd-group__head--${group.className}`">
								<span class="cvd-dot" :class="`cvd-dot--${group.className}`" />{{ group.label }}
							</span>
						</div>

						<div v-for="item in group.items" :key="item.title" class="cvd-entry">
							<div class="cvd-entry__title">{{ item.title }}</div>
							<div v-if="item.confidence !== null" class="cvd-entry__conf">
								<span class="cvd-entry__conf-label">置信</span>
								<span class="cvd-meter__track">
									<span class="cvd-meter__fill" :style="{ width: `${item.confidence}%` }" />
								</span>
								<span class="cvd-meter__num">{{ item.confidence }}%</span>
							</div>
							<div v-if="item.attribution" class="cvd-entry__text">{{ item.attribution }}</div>
							<div v-if="item.quote" class="cvd-evidence">
								「{{ item.quote }}」
								<div class="cvd-evidence__meta">{{ item.time ?? "时间未知" }}</div>
							</div>
						</div>
					</section>

					<div v-if="!visibleGroups.length" class="cvd-placeholder">
						<h3>这一组还没有条目</h3>
						<p>换成「全部」看看，或者点右上角「重新研究」补一轮。</p>
					</div>
				</div>

				<!-- 右：光谱 / 双轨 / 破冰，条目再多也保持可见 -->
				<div class="cvd-rail">
					<div v-if="spectrumAxes.length" class="cvd-card">
						<div class="cvd-card__head">
							<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /></svg>
							<span class="cvd-card__title">三维性格光谱</span>
						</div>
						<div v-for="axis in spectrumAxes" :key="axis.key" class="cvd-spec" :style="axis.style">
							<div class="cvd-spec__labels">
								<span>{{ axis.left }}</span>
								<span class="cvd-spec__dim">
									{{ axis.label }}<span class="cvd-spec__val">{{ axis.side.score }}</span>
								</span>
								<span>{{ axis.right }}</span>
							</div>
							<div class="cvd-spec__track">
								<span class="cvd-spec__dot" :style="{ left: `${axis.side.score}%` }" />
							</div>
							<div v-if="axis.side.note" class="cvd-spec__note">{{ axis.side.note }}</div>
						</div>
					</div>

					<div v-if="dualTracks.length" class="cvd-card">
						<div class="cvd-card__head">
							<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z" /></svg>
							<span class="cvd-card__title">关系双轨详情</span>
						</div>
						<div v-for="track in dualTracks" :key="track.key" class="cvd-temp">
							<div class="cvd-temp__top">
								<span class="cvd-temp__label">{{ track.label }}</span>
								<span
									class="cvd-temp__level"
									:style="{ color: (track.side.score ?? 0) >= 20 ? 'var(--ok)' : 'var(--warn)' }"
								>
									{{ track.side.level }} · {{ track.side.score }}
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
					</div>

					<div v-if="smallTalk" class="cvd-card">
						<div class="cvd-card__head">
							<svg class="cvd-ico" viewBox="0 0 24 24"><path d="M4 18h16M7 18V9M12 18V6M17 18v-5" /></svg>
							<span class="cvd-card__title">破冰与家常弹药</span>
						</div>
						<p v-if="smallTalk.strategy_advice" class="cvd-muted" style="margin: 0 0 8px">
							{{ smallTalk.strategy_advice }}
						</p>
						<ul v-if="smallTalk.personal_hooks.length" class="cvd-hooks">
							<li v-for="(hook, index) in smallTalk.personal_hooks" :key="index">
								<span class="cvd-cat">{{ hook.category }}</span>{{ hook.detail }}
							</li>
						</ul>
						<div v-if="smallTalk.ready_to_use_icebreaker" class="cvd-ice" style="margin-top: 10px">
							<div class="cvd-ice__head">
								<span class="cvd-ice__label">破冰话术</span>
								<button class="cvd-ice__copy" @click="copyIcebreaker">
									{{ icebreakerCopied ? "已复制" : "复制" }}
								</button>
							</div>
							<div class="cvd-ice__text">{{ smallTalk.ready_to_use_icebreaker.zh }}</div>
						</div>
					</div>
				</div>
			</div>

			<div v-else class="cvd-placeholder">
				<h3>还没有深度画像</h3>
				<p>导入聊天记录，或点右上角「重新研究」，智能体会把人物白描、心理归因与相处说明书生成出来。</p>
			</div>
		</div>
	</div>
</template>
