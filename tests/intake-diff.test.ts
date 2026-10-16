import { describe, expect, test } from "bun:test";
import { diffArchiveMessages, splitMessageBlocks } from "../app/../server/utils/intake-archive";

// 纯函数测试：不连数据库，可单独跑（bun test tests/intake-diff.test.ts）。
// 注意：intake-archive 顶层只做纯定义，导入本身不触发数据库连接。

function wrap(original: string): string {
	return ["【微信聊天记录】对方昵称：Michael；来源文件：a.txt", "---", original, "---", "以上为该会话的全部聊天原文，未做任何加工。"].join("\n");
}

const OLD_CHAT = `[2026-09-25 21:25] Michael: I recently bought some glasses and the supplier lied about the size.
[2026-09-27 11:40] Michael: Great review coming once delivered and verified.`;

const NEW_LINE = `[2026-10-16 09:00] Michael: Package arrived today, thank you!`;

describe("消息级指纹增量去重", () => {
	test("按消息头切块，前导行单独保留", () => {
		const split = splitMessageBlocks(`昵称：Michael\n${OLD_CHAT}\n尾部说明`);
		expect(split).not.toBeNull();
		expect(split?.preamble).toBe("昵称：Michael");
		expect(split?.blocks).toHaveLength(2);
		expect(split?.blocks[0]).toContain("lied about the size");
	});

	test("认不出逐条格式时返回 null（整段按新增处理）", () => {
		expect(splitMessageBlocks("随便一段没有时间戳的文字")).toBeNull();
	});

	test("全量重发时只保留新增的一块，历史消息被指纹减掉", () => {
		const stored = wrap(OLD_CHAT);
		const incoming = `${OLD_CHAT}\n${NEW_LINE}`;

		const diff = diffArchiveMessages(incoming, [stored]);

		expect(diff.isIncremental).toBe(true);
		expect(diff.incomingCount).toBe(3);
		expect(diff.storedCount).toBe(2);
		expect(diff.newCount).toBe(1);
		expect(diff.newBody).toContain("Package arrived today");
		expect(diff.newBody).not.toContain("lied about the size");
	});

	test("零新增：整段都被指纹命中，newCount 为 0", () => {
		const diff = diffArchiveMessages(OLD_CHAT, [wrap(OLD_CHAT)]);

		expect(diff.isIncremental).toBe(true);
		expect(diff.newCount).toBe(0);
		expect(diff.newBody).not.toContain("Great review");
	});

	test("留底的包装层（头部/分隔线/尾部）不影响指纹比对", () => {
		const diff = diffArchiveMessages(OLD_CHAT, [wrap(OLD_CHAT)]);
		expect(diff.storedCount).toBe(2);
	});

	test("消息内容被编辑后视为新增（特性而非缺陷）", () => {
		const edited = OLD_CHAT.replace("delivered and verified", "delivered and double-checked");
		const diff = diffArchiveMessages(`${edited}\n${NEW_LINE}`, [wrap(OLD_CHAT)]);

		expect(diff.newCount).toBe(2);
	});

	test("多份历史留底取并集比对", () => {
		const part1 = `[2026-09-25 21:25] Michael: the supplier lied about the size.`;
		const part2 = `[2026-09-27 11:40] Michael: Great review coming once delivered and verified.`;
		const incoming = `${part1}\n${part2}\n${NEW_LINE}`;

		const diff = diffArchiveMessages(incoming, [wrap(part1), wrap(part2)]);

		expect(diff.newCount).toBe(1);
		expect(diff.newBody).toBe(NEW_LINE);
	});

	test("首导入（无历史）整段都是新增", () => {
		const diff = diffArchiveMessages(OLD_CHAT, []);

		expect(diff.isIncremental).toBe(true);
		expect(diff.newCount).toBe(2);
	});
});
