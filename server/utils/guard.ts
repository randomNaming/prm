import { createError, isError, type H3Error } from "h3";
import { databaseConfigured } from "./db";

export async function guarded<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (isError(error)) throw error;

		if (!databaseConfigured()) {
			throw createError({
				statusCode: 503,
				statusMessage: "数据库未配置：请在 .env 中填写 DATABASE_URL。",
			});
		}

		throw createError({
			statusCode: 500,
			statusMessage: error instanceof Error ? error.message : "服务器内部错误。",
		});
	}
}

export function notFound(message: string): H3Error {
	return createError({ statusCode: 404, statusMessage: message });
}

export function badRequest(message: string): H3Error {
	return createError({ statusCode: 400, statusMessage: message });
}
