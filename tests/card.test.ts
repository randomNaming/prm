import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { cardDrafts } from "../server/db/schema";
import {
	checkCardRateLimit,
	confirmCardDraft,
	discardCardDraft,
	imageHashOf,
	intakeCard,
	listCardDrafts,
	parseCardImages,
	resetCardRateLimit,
	sweepCardDrafts,
	type CardImage,
} from "../server/utils/cards";
import { CONFIG } from "../server/utils/config";
import { closeDb, db } from "../server/utils/db";
import { newId, nowMs } from "../server/utils/ids";
import { findCompanyByName } from "../server/utils/companies";
import { contactFixture, resetDatabase, useVisionEnv } from "./helpers";
import { getContact } from "../server/utils/contacts";
import { startStubModel } from "./stub-model";

beforeEach(async () => {
	await resetDatabase();
	resetCardRateLimit();
});

afterAll(async () => {
	await closeDb();
});

/** 最小合法 JPEG：只有文件头魔数是真 JPEG，服务端只认魔数，不需要完整图片。 */
function jpegDataUrl(): string {
	const buffer = Buffer.alloc(64, 0x00);
	buffer[0] = 0xff;
	buffer[1] = 0xd8;
	buffer[2] = 0xff;
	buffer[3] = 0xe0;

	return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function pngDataUrl(): string {
	const buffer = Buffer.alloc(64, 0x00);
	buffer[0] = 0x89;
	buffer[1] = 0x50;
	buffer[2] = 0x4e;
	buffer[3] = 0x47;

	return `data:image/png;base64,${buffer.toString("base64")}`;
}

function statusCodeOf(error: unknown): number | null {
	if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;

	return Number((error as { statusCode: unknown }).statusCode);
}

async function expectHttpError(run: () => Promise<unknown>, expected: number): Promise<Record<string, unknown>> {
	try {
		await run();
	} catch (error) {
		expect(statusCodeOf(error)).toBe(expected);

		return (error ?? {}) as Record<string, unknown>;
	}

	throw new Error(`应当抛出 statusCode=${expected}`);
}

const STUB_CARD = JSON.stringify({
	fields: {
		name: "张三",
		company: "宁波明州照明有限公司",
		title: "采购经理",
		phone: "138-0013-8000",
		email: "",
		wechat: "",
		country: "中国",
		address: "",
	},
	evidence: { company: "宁波明州照明有限公司" },
});

describe("图片校验：只认文件头魔数与体积上限", () => {
	test("合法 JPEG 与 PNG 通过，并带解码后字节数", () => {
		const images = parseCardImages([jpegDataUrl(), pngDataUrl()]);

		expect(images).toHaveLength(2);
		expect(images[0].mime).toBe("image/jpeg");
		expect(images[1].mime).toBe("image/png");
		expect(images[0].bytes).toBeGreaterThan(0);
	});

	test("非 data URL / 白名单外的类型 → 400", async () => {
		await expectHttpError(() => Promise.resolve(parseCardImages(["https://example.com/a.jpg"]),), 400);
		await expectHttpError(() => Promise.resolve(parseCardImages(["data:image/gif;base64,AAAA"])), 400);
	});

	test("魔数不符（声明 jpeg 实际不是）→ 400", async () => {
		const fake = `data:image/jpeg;base64,${Buffer.alloc(64, 0x00).toString("base64")}`;

		await expectHttpError(() => Promise.resolve(parseCardImages([fake])), 400);
	});

	test("单张超过 3MB base64 → 413，三张 → 400", async () => {
		const big = `data:image/jpeg;base64,${"A".repeat(3 * 1024 * 1024 + 10)}`;

		await expectHttpError(() => Promise.resolve(parseCardImages([big])), 413);
		await expectHttpError(
			() => Promise.resolve(parseCardImages([jpegDataUrl(), pngDataUrl(), jpegDataUrl()])),
			400,
		);
	});
});

describe("图片指纹与限流", () => {
	test("同一组图哈希一致，与张数顺序无关地稳定", () => {
		const a = parseCardImages([jpegDataUrl(), pngDataUrl()]);
		const b = parseCardImages([jpegDataUrl(), pngDataUrl()]);

		expect(imageHashOf(a)).toBe(imageHashOf(b));
		expect(imageHashOf(a)).toHaveLength(64);
	});

	test("每设备每分钟 10 次：第 11 次 429，其它设备不受影响", () => {
		for (let index = 0; index < CONFIG.card.ratePerDevice; index += 1) {
			checkCardRateLimit("dev-1");
		}

		let caught: unknown = null;
		try {
			checkCardRateLimit("dev-1");
		} catch (e) {
			caught = e;
		}

		expect(statusCodeOf(caught)).toBe(429);
		expect((caught as { data?: { code?: string } }).data?.code).toBe("rate_limited");

		expect(() => checkCardRateLimit("dev-2")).not.toThrow();
	});
});

describe("收图并识别：写草稿、判重、失败留痕", () => {
	test("识别成功 → pending 草稿带字段与 evidence，模型请求带图片", async () => {
		const stub = await startStubModel([{ content: STUB_CARD }]);
		useVisionEnv(stub.baseUrl);

		try {
			const result = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });

			expect(result.ok).toBe(true);
			expect(result.draft.status).toBe("pending");
			expect(result.draft.fields.name).toBe("张三");
			expect(result.draft.fields.company).toBe("宁波明州照明有限公司");
			expect(result.draft.evidence.company).toBe("宁波明州照明有限公司");
			expect(result.draft.matchedContactId).toBeNull();
			expect(result.meta.deduped).toBe(false);

			// 模型请求应是多模态消息：带 data URL 图片，且系统提示在场。
			expect(stub.requests).toHaveLength(1);
			const payload = JSON.stringify(stub.requests[0].messages);
			expect(payload).toContain("data:image/jpeg;base64,");
			expect(payload).toContain("名片识别引擎");
		} finally {
			await stub.close();
		}
	});

	test("同一组图重复提交：返回同一条 pending 草稿，模型只调一次", async () => {
		const stub = await startStubModel([{ content: STUB_CARD }]);
		useVisionEnv(stub.baseUrl);

		try {
			const first = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });
			const second = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });

			expect(second.draft.id).toBe(first.draft.id);
			expect(second.meta.deduped).toBe(true);
			expect(stub.requests).toHaveLength(1);
		} finally {
			await stub.close();
		}
	});

	test("模型返回非 JSON：字段全空，不报错、不编造", async () => {
		const stub = await startStubModel([{ content: "我看到了一张名片，很普通。" }]);
		useVisionEnv(stub.baseUrl);

		try {
			const result = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });

			expect(result.ok).toBe(true);
			expect(Object.values(result.draft.fields).every((value) => value === "")).toBe(true);
		} finally {
			await stub.close();
		}
	});

	test("模型调用失败 → 502 vision_failed，且留下 failed 草稿（无字段值）", async () => {
		const stub = await startStubModel([{ status: 500 }]);
		useVisionEnv(stub.baseUrl);

		try {
			const error = await expectHttpError(
				() => intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] }),
				502,
			);

			const data = error.data as { code?: string; draftId?: string } | undefined;
			expect(data?.code).toBe("vision_failed");
			expect(typeof data?.draftId).toBe("string");

			const failed = await db()
				.select()
				.from(cardDrafts)
				.where(eq(cardDrafts.status, "failed"));

			expect(failed).toHaveLength(1);
			expect(failed[0].name).toBeNull();
			expect(failed[0].error).not.toBeNull();
			expect(failed[0].imageHash).toHaveLength(64);
		} finally {
			await stub.close();
		}
	});
});

describe("识别阶段撞库：电话归一化 → 邮箱 → 姓名+公司", () => {
	test("电话归一化命中（库内存的是去掉分隔符的写法）", async () => {
		const existing = await contactFixture({ firstName: "张三", phone: "13800138000" });
		const stub = await startStubModel([{ content: STUB_CARD }]);
		useVisionEnv(stub.baseUrl);

		try {
			const result = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });

			expect(result.draft.matchedContactId).toBe(existing.id);
		} finally {
			await stub.close();
		}
	});

	test("邮箱完全一致命中（姓名不同也认）", async () => {
		const existing = await contactFixture({ firstName: "老张", email: "san.zhang@example.com" });
		const stub = await startStubModel([
			{
				content: JSON.stringify({
					fields: { name: "张三", email: "san.zhang@example.com" },
					evidence: {},
				}),
			},
		]);
		useVisionEnv(stub.baseUrl);

		try {
			const result = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });

			expect(result.draft.matchedContactId).toBe(existing.id);
		} finally {
			await stub.close();
		}
	});
});

describe("确认草稿：建/并联系人，空值不覆盖人工数据", () => {
	test("命中联系人 → 更新：只补非空字段，公司找到后关联", async () => {
		const existing = await contactFixture({ firstName: "张三", phone: "13800138000", title: "销售总监" });
		const stub = await startStubModel([{ content: STUB_CARD }]);
		useVisionEnv(stub.baseUrl);

		try {
			const intake = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });
			const confirmed = await confirmCardDraft(intake.draft.id, {
				fields: { name: "张三", company: "宁波明州照明有限公司" },
			});

			expect(confirmed.action).toBe("updated");
			expect(confirmed.contactId).toBe(existing.id);

			const updated = await getContact(existing.id);
			expect(updated?.phone).toBe("13800138000");
			expect(updated?.title).toBe("销售总监");

			const company = await findCompanyByName("宁波明州照明有限公司");
			expect(company?.id ?? null).toBe(updated?.companyId ?? null);
		} finally {
			await stub.close();
		}
	});

	test("未命中 → 新建：wechat 映射微信号、空字段为 null", async () => {
		const stub = await startStubModel([
			{
				content: JSON.stringify({
					fields: { name: "王测试", wechat: "wangtest", phone: "13911112222" },
					evidence: {},
				}),
			},
		]);
		useVisionEnv(stub.baseUrl);

		try {
			const intake = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });
			const confirmed = await confirmCardDraft(intake.draft.id, { fields: intake.draft.fields });

			expect(confirmed.action).toBe("created");

			const created = await getContact(confirmed.contactId);
			expect(created?.firstName).toBe("王测试");
			expect(created?.wechatId).toBe("wangtest");
			expect(created?.title).toBeNull();

			const [draft] = await db().select().from(cardDrafts).where(eq(cardDrafts.id, intake.draft.id));
			expect(draft.status).toBe("confirmed");
			expect(draft.contactId).toBe(confirmed.contactId);
			expect(draft.confirmedAt).not.toBeNull();
		} finally {
			await stub.close();
		}
	});

	test("姓名缺失 → 400；对已丢弃草稿确认 → 404", async () => {
		const stub = await startStubModel([{ content: STUB_CARD }]);
		useVisionEnv(stub.baseUrl);

		try {
			const intake = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });

			await expectHttpError(
				() => confirmCardDraft(intake.draft.id, { fields: { company: "只有公司" } }),
				400,
			);

			await discardCardDraft(intake.draft.id, "拍错了");
			await expectHttpError(
				() => confirmCardDraft(intake.draft.id, { fields: { name: "张三" } }),
				404,
			);
		} finally {
			await stub.close();
		}
	});
});

describe("列表与保留期清理", () => {
	test("默认只返回 pending，新草稿在前", async () => {
		const stub = await startStubModel([{ content: STUB_CARD }]);
		useVisionEnv(stub.baseUrl);

		try {
			const first = await intakeCard({ deviceId: "dev-1", images: [jpegDataUrl()] });
			// 换一张图（不同哈希）再拍一张。
			const second = await intakeCard({ deviceId: "dev-1", images: [pngDataUrl()] });
			await discardCardDraft(second.draft.id);

			const drafts = await listCardDrafts({});

			expect(drafts).toHaveLength(1);
			expect(drafts[0].id).toBe(first.draft.id);
		} finally {
			await stub.close();
		}
	});

	test("草稿统一保留 1 天：过期的全部清走，未到期的 pending 原样保留", async () => {
		const expired = nowMs() - CONFIG.time.dayMs - 1000;

		await db().insert(cardDrafts).values({
			id: newId(),
			deviceId: "dev-1",
			status: "pending",
			createdAt: expired,
		});
		await db().insert(cardDrafts).values({
			id: newId(),
			deviceId: "dev-1",
			status: "confirmed",
			contactId: newId(),
			confirmedAt: nowMs(),
			createdAt: expired,
		});
		const freshId = newId();
		await db().insert(cardDrafts).values({
			id: freshId,
			deviceId: "dev-1",
			status: "pending",
			createdAt: nowMs(),
		});

		await sweepCardDrafts();

		const rows = await db().select().from(cardDrafts);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(freshId);
		expect(rows[0].status).toBe("pending");
	});
});
