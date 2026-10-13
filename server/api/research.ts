import { z } from "zod";
import { agentCapability } from "../utils/env";
import { badRequest, guarded, notFound } from "../utils/guard";
import { enqueueCompanyResearch, enqueueResearch } from "../utils/queue";
import { getContact } from "../utils/contacts";
import { getCompany } from "../utils/companies";

const body = z.object({
	subject: z.enum(["contact", "company"]),
	id: z.string().trim().min(1).max(36),
});

export default defineEventHandler((event) =>
	guarded(async () => {
		const input = body.parse(await readBody(event));
		const capability = agentCapability();

		if (!capability.enabled) throw badRequest(capability.reason);

		if (input.subject === "contact") {
			const contact = await getContact(input.id);
			if (!contact) throw notFound("联系人不存在。");

			const taskId = await enqueueResearch(input.id, "手动点「重新研究」。");

			return { queued: true, taskId };
		}

		const company = await getCompany(input.id);
		if (!company) throw notFound("公司不存在。");

		const taskId = await enqueueCompanyResearch(input.id, "手动点「重新研究」。");

		return { queued: true, taskId };
	}),
);
