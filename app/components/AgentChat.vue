<script setup lang="ts">
import type { ChatMessage, ChatToolCall, Conversation } from "~/types/domain";

const props = defineProps<{
	contactId?: string | null;
	companyId?: string | null;
	dealId?: string | null;
}>();

const api = useApi();

const conversations = ref<Conversation[]>([]);
const activeId = ref<string | null>(null);
const messages = ref<ChatMessage[]>([]);
const input = ref("");
const streaming = ref(false);
const draftText = ref("");
const draftReasoning = ref("");
const draftTools = ref<ChatToolCall[]>([]);
const errorText = ref("");
const historyLoaded = ref(false);

const focus = computed(() => ({
	contactId: props.contactId ?? undefined,
	companyId: props.companyId ?? undefined,
	dealId: props.dealId ?? undefined,
}));

async function loadConversations() {
	try {
		const result = await api.conversations(focus.value);
		conversations.value = result.conversations;
	} catch {
		conversations.value = [];
	}
}

async function openConversation(id: string) {
	activeId.value = id;
	const result = await api.messages(id);
	messages.value = result.messages;
}

function startNew() {
	activeId.value = null;
	messages.value = [];
	errorText.value = "";
}

function handleEvent(event: Record<string, unknown>) {
	if (event.type === "start" && typeof event.conversationId === "string") {
		activeId.value = event.conversationId;
		return;
	}

	if (event.type === "reasoning" && typeof event.text === "string") {
		draftReasoning.value += event.text;
		return;
	}

	if (event.type === "text" && typeof event.text === "string") {
		draftText.value += event.text;
		return;
	}

	if (event.type === "tool" && typeof event.name === "string") {
		draftTools.value.push({ name: event.name, input: event.input, result: null });
		return;
	}

	if (event.type === "tool_result" && typeof event.name === "string") {
		const call = draftTools.value.find((item) => item.name === event.name && item.result === null);
		if (call) call.result = event.result;
		return;
	}

	if (event.type === "error" && typeof event.message === "string") {
		errorText.value = event.message;
	}
}

async function send() {
	const text = input.value.trim();
	if (!text || streaming.value) return;

	input.value = "";
	errorText.value = "";
	draftText.value = "";
	draftReasoning.value = "";
	draftTools.value = [];
	streaming.value = true;

	messages.value.push({
		id: `local-${Date.now()}`,
		conversationId: activeId.value ?? "",
		role: "user",
		content: text,
		reasoning: null,
		toolCalls: null,
		createdAt: Date.now(),
	});

	try {
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...focus.value, conversationId: activeId.value, message: text }),
		});

		const contentType = response.headers.get("content-type") ?? "";

		if (!contentType.includes("text/event-stream")) {
			const payload = (await response.json()) as { reason?: string; statusMessage?: string };
			errorText.value = payload.reason ?? payload.statusMessage ?? "智能体不可用。";
			messages.value.pop();

			return;
		}

		const reader = response.body?.getReader();
		if (!reader) return;

		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const frames = buffer.split("\n\n");
			buffer = frames.pop() ?? "";

			for (const frame of frames) {
				const line = frame.split("\n").find((item) => item.startsWith("data: "));
				if (!line) continue;

				handleEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
			}
		}
	} catch (error) {
		errorText.value = error instanceof Error ? error.message : "对话失败。";
	} finally {
		streaming.value = false;

		if (activeId.value) {
			await openConversation(activeId.value);
			await loadConversations();
		}
	}
}

onMounted(async () => {
	await loadConversations();
	historyLoaded.value = true;
});

watch(focus, async () => {
	startNew();
	await loadConversations();
});
</script>

<template>
	<div class="crm-agent">
		<div class="crm-agent__sidebar">
			<el-button size="small" type="primary" plain style="width: 100%" @click="startNew">
				新对话
			</el-button>
			<div
				v-for="conversation in conversations"
				:key="conversation.id"
				class="crm-agent__conversation"
				:class="{ 'crm-agent__conversation--active': conversation.id === activeId }"
				@click="openConversation(conversation.id)"
			>
				<div class="crm-agent__conversation-title">{{ conversation.title ?? "未命名对话" }}</div>
				<div class="crm-muted crm-agent__conversation-time">
					{{ formatRelative(conversation.lastMessageAt) }}
				</div>
			</div>
			<el-empty
				v-if="historyLoaded && conversations.length === 0"
				description="还没有历史对话"
				:image-size="60"
			/>
		</div>

		<div class="crm-agent__main">
			<div class="crm-chat">
				<div v-for="message in messages" :key="message.id" class="crm-chat__item">
					<el-collapse v-if="message.reasoning" class="crm-reasoning">
						<el-collapse-item title="思考过程">
							<div class="crm-quote">{{ message.reasoning }}</div>
						</el-collapse-item>
					</el-collapse>
					<div
						class="crm-bubble"
						:class="message.role === 'user' ? 'crm-bubble--user' : 'crm-bubble--assistant'"
					>
						{{ message.content }}
					</div>
					<div v-for="(call, index) in message.toolCalls ?? []" :key="index" class="crm-tool">
						工具：{{ call.name }}
					</div>
				</div>

				<div v-if="streaming" class="crm-chat__item">
					<el-collapse v-if="draftReasoning" class="crm-reasoning">
						<el-collapse-item title="思考过程（生成中）">
							<div class="crm-quote">{{ draftReasoning }}</div>
						</el-collapse-item>
					</el-collapse>
					<div v-for="(call, index) in draftTools" :key="index" class="crm-tool">
						工具：{{ call.name }}{{ call.result === null ? "（执行中）" : "" }}
					</div>
					<div class="crm-bubble crm-bubble--assistant">{{ draftText || "正在思考…" }}</div>
				</div>

				<el-empty v-if="!streaming && messages.length === 0" description="问点什么，比如「这个联系人是谁」" />
			</div>

			<el-alert v-if="errorText" type="error" :closable="false" show-icon :title="errorText" />

			<div class="crm-agent__input">
				<el-input
					v-model="input"
					type="textarea"
					:rows="3"
					placeholder="用中文提问，回车换行，点发送。"
					@keydown.ctrl.enter="send"
				/>
				<el-button type="primary" :loading="streaming" @click="send">发送</el-button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.crm-agent {
	display: grid;
	grid-template-columns: 220px 1fr;
	gap: 16px;
}

.crm-agent__sidebar {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.crm-agent__conversation {
	border: 1px solid var(--crm-line);
	border-radius: 6px;
	padding: 8px 10px;
	cursor: pointer;
	background: #fff;
}

.crm-agent__conversation--active {
	border-color: var(--crm-brand);
}

.crm-agent__conversation-title {
	font-size: 13px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.crm-agent__conversation-time {
	font-size: 12px;
}

.crm-agent__main {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.crm-chat__item {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.crm-agent__input {
	display: flex;
	gap: 8px;
	align-items: flex-end;
}
</style>
