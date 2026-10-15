import { describe, expect, test } from "bun:test";
import { parseAddress } from "../app/utils/address-parse";

// 纯函数测试：不连数据库，可以单独跑（bun test tests/address-parse.test.ts）。

describe("地址识别", () => {
	test("阿里国际站样例：姓名 + 电话 + 重复街道 + 邮编 + 城市 + 省州 + 国家", () => {
		const parsed = parseAddress(
			"Maelle AGONDJO DONDIA +33 668496975, 18 Bd Vincent Auriol, 18 Boulevard Vincent Auriol, 31170, Tournefeuille, Haute-Garonne, France",
		);

		expect(parsed).not.toBeNull();
		expect(parsed?.name).toBe("Maelle AGONDJO DONDIA");
		expect(parsed?.phone).toBe("+33 668496975");
		expect(parsed?.country).toBe("法国");
		expect(parsed?.postalCode).toBe("31170");
		expect(parsed?.city).toBe("Tournefeuille");
		expect(parsed?.region).toBe("Haute-Garonne");
		// 缩写归一去重：Bd 展开后与 Boulevard 同一条，保留长的。
		expect(parsed?.street).toBe("18 Boulevard Vincent Auriol");
		// 邮编有自己的字段，地址串里不重复。
		expect(parsed?.address).toBe("18 Boulevard Vincent Auriol, Tournefeuille, Haute-Garonne");
		expect(parsed?.fullAddress).toBe(
			"18 Boulevard Vincent Auriol, Tournefeuille, Haute-Garonne, 31170, 法国",
		);
	});

	test("意大利样例：门牌号开头街道 + 邮编 + 城市 + 大区 + 国家", () => {
		const parsed = parseAddress(
			"Nail Toutaev +39 3756684387, 5 Via Bertolt Brecht, 00142, Rome, Lazio, Italy",
		);

		expect(parsed?.name).toBe("Nail Toutaev");
		expect(parsed?.phone).toBe("+39 3756684387");
		expect(parsed?.country).toBe("意大利");
		expect(parsed?.postalCode).toBe("00142");
		expect(parsed?.city).toBe("Rome");
		expect(parsed?.region).toBe("Lazio");
		expect(parsed?.address).toBe("5 Via Bertolt Brecht, Rome, Lazio");
	});

	test("美式样例：州缩写 + 邮编，没有姓名电话国家", () => {
		const parsed = parseAddress("26 crimson drive, norristown, pa 19401");

		expect(parsed?.name).toBeNull();
		expect(parsed?.phone).toBeNull();
		expect(parsed?.postalCode).toBe("19401");
		expect(parsed?.region).toBe("pa");
		expect(parsed?.city).toBe("norristown");
		expect(parsed?.address).toBe("26 crimson drive, norristown, pa");
		expect(parsed?.fullAddress).toBe("26 crimson drive, norristown, pa, 19401");
	});

	test("中文样例：国家归一、街道整段保留不被吃掉", () => {
		const parsed = parseAddress("张三, 北京市朝阳区建国路 1 号, 100000, 中国");

		expect(parsed?.name).toBe("张三");
		expect(parsed?.country).toBe("中国");
		expect(parsed?.postalCode).toBe("100000");
		expect(parsed?.address).toBe("北京市朝阳区建国路 1 号");
	});

	test("英文写法的国家与邮编在前的顺序也能认", () => {
		const parsed = parseAddress("Li Si, 221B Baker Street, London, NW1 6XE, United Kingdom");

		expect(parsed?.name).toBe("Li Si");
		expect(parsed?.country).toBe("英国");
		expect(parsed?.postalCode).toBe("NW1 6XE");
		expect(parsed?.city).toBe("London");
		expect(parsed?.address).toBe("221B Baker Street, London");
		expect(parsed?.fullAddress).toBe("221B Baker Street, London, NW1 6XE, 英国");
	});

	test("什么都不像时返回 null，不硬凑", () => {
		expect(parseAddress("随便一段话")).toBeNull();
		expect(parseAddress("   ")).toBeNull();
	});
});
