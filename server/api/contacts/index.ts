import { contactInput, listQuery } from "../../utils/validate";
import { createContact, listContacts } from "../../utils/contacts";
import { agentCapability } from "../../utils/env";
import { guarded } from "../../utils/guard";
import { enqueueResearch } from "../../utils/queue";

export default defineEventHandler((event) =>
	guarded(async () => {
		if (event.method === "POST") {
			const input = contactInput.parse(await readBody(event));
			const contact = await createContact(input);

			if (agentCapability().enabled) {
				await enqueueResearch(contact.id, "新建联系人，自动触发一次后台研究。");
			}

			return { contact };
		}

		return listContacts(listQuery.parse(getQuery(event)));
	}),
);
