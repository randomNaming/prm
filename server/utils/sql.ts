import { sql, type SQLWrapper } from "drizzle-orm";

export function containsText(column: SQLWrapper, term: string) {
	return sql`INSTR(IFNULL(${column}, ''), ${term}) > 0`;
}

export function concatContains(parts: SQLWrapper[], term: string) {
	const joined = sql.join(parts.map((part) => sql`IFNULL(${part}, '')`), sql`, `);

	return sql`INSTR(CONCAT(${joined}), ${term}) > 0`;
}
