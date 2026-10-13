import { createId } from "@paralleldrive/cuid2";

export function newId(): string {
	return createId();
}

export function nowMs(): number {
	return Date.now();
}

export function toMs(value: Date | number | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	return value instanceof Date ? value.getTime() : value;
}
