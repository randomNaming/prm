import { computed, onMounted, ref, toValue, type MaybeRefOrGetter } from "vue";
import type { ListColumn } from "~/utils/list-columns";

/**
 * 列表显示哪些字段。
 *
 * 偏好只存在浏览器本地：单人系统没有「用户」概念，不需要也不该为它建表。
 * 首屏用默认列渲染（服务端与客户端一致，不会水合错位），挂载后再读回本地偏好。
 */
export function useTableColumns<T>(
	storageKey: string,
	columns: MaybeRefOrGetter<ListColumn<T>[]>,
) {
	const all = computed(() => toValue(columns));

	const defaults = (): string[] =>
		all.value.filter((column) => column.defaultVisible).map((column) => column.key);

	const visible = ref<string[]>(defaults());
	const ready = ref(false);

	function read(): string[] {
		try {
			const raw = window.localStorage.getItem(storageKey);
			if (!raw) return defaults();

			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return defaults();

			// 用户把列全部取消勾选是合法状态，不要偷偷回退成默认。
			return parsed.filter((key): key is string => typeof key === "string");
		} catch {
			return defaults();
		}
	}

	function setVisible(keys: string[]) {
		visible.value = [...keys];

		try {
			window.localStorage.setItem(storageKey, JSON.stringify(visible.value));
		} catch {
			// 无痕模式或配额写满：只影响「记住偏好」，不影响本次使用。
		}
	}

	onMounted(() => {
		visible.value = read();
		ready.value = true;
	});

	const visibleColumns = computed(() =>
		all.value.filter((column) => visible.value.includes(column.key)),
	);

	return {
		ready,
		visible,
		visibleColumns,
		setVisible,
		reset: () => setVisible(defaults()),
	};
}
