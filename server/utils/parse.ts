import { z } from "zod";
import {
	ACTIVITY_KINDS,
	COMPANY_FACT_FIELDS,
	DEAL_STAGES,
	DEAL_STATUSES,
	FACT_FIELDS,
	FACT_STATUSES,
	FIELD_ORIGINS,
	FIELD_SCOPES,
	FIELD_STATUSES,
	type ActivityKind,
	type ChatToolCall,
	type CompanyFactField,
	type DealStage,
	type DealStatus,
	type Evidence,
	type FactField,
	type FactStatus,
	type FieldOrigin,
	type FieldScope,
	type FieldStatus,
	type TaskPayload,
} from "../../app/types/domain";
import { evidenceItem } from "./validate";

const dealStageSchema = z.enum(DEAL_STAGES);
const dealStatusSchema = z.enum(DEAL_STATUSES);
const activityKindSchema = z.enum(ACTIVITY_KINDS);
const factFieldSchema = z.enum(FACT_FIELDS);
const companyFactFieldSchema = z.enum(COMPANY_FACT_FIELDS);
const factStatusSchema = z.enum(FACT_STATUSES);
const evidenceListSchema = z.array(evidenceItem);
const toolCallSchema = z.object({
	name: z.string(),
	input: z.unknown(),
	result: z.unknown(),
});

export function dealStage(value: string): DealStage {
	return dealStageSchema.parse(value);
}

export function dealStatus(value: string): DealStatus {
	return dealStatusSchema.parse(value);
}

export function activityKind(value: string): ActivityKind {
	return activityKindSchema.parse(value);
}

export function factField(value: string): FactField {
	return factFieldSchema.parse(value);
}

export function factStatus(value: string): FactStatus {
	return factStatusSchema.parse(value);
}

export function companyFactField(value: string): CompanyFactField {
	return companyFactFieldSchema.parse(value);
}

export function parseEvidence(value: unknown): Evidence[] {
	return evidenceListSchema.parse(value);
}

export function parseToolCalls(value: unknown): ChatToolCall[] | null {
	if (value === null || value === undefined) return null;

	return z.array(toolCallSchema).parse(value);
}

const taskPayloadSchema = z.object({
	reason: z.string().nullish().transform((value) => value ?? null),
	days: z.number().nullish().transform((value) => value ?? null),
});

export function parseTaskPayload(value: unknown): TaskPayload | null {
	if (value === null || value === undefined) return null;

	return taskPayloadSchema.parse(value);
}

export function optionalText(value: string | null | undefined): string | null {
	return value ?? null;
}

const fieldScopeSchema = z.enum(FIELD_SCOPES);
const fieldStatusSchema = z.enum(FIELD_STATUSES);
const fieldOriginSchema = z.enum(FIELD_ORIGINS);
const aliasListSchema = z.array(z.string());

export function fieldScope(value: string): FieldScope {
	return fieldScopeSchema.parse(value);
}

export function fieldStatus(value: string): FieldStatus {
	return fieldStatusSchema.parse(value);
}

export function fieldOrigin(value: string): FieldOrigin {
	return fieldOriginSchema.parse(value);
}

export function parseAliases(value: unknown): string[] {
	return aliasListSchema.parse(value);
}

export function parseOptions(value: unknown): string[] {
	if (value === null || value === undefined) return [];

	return aliasListSchema.parse(value);
}
