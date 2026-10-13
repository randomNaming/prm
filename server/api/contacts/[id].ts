import { contactInput } from "../../utils/validate";
import {
	archiveContact,
	contactDetail,
	updateContact,
} from "../../utils/contacts";
import { guarded, notFound } from "../../utils/guard";

export default defineEventHandler((event) =>
	guarded(async () => {
		const id = getRouterParam(event, "id");
		if (!id) throw notFound("联系人不存在。");

		if (event.method === "GET") {
			const detail = await contactDetail(id);
			if (!detail) throw notFound("联系人不存在。");

			return detail;
		}

		if (event.method === "PUT") {
			const input = contactInput.parse(await readBody(event));
			const contact = await updateContact(id, input);
			if (!contact) throw notFound("联系人不存在。");

			return { contact };
		}

		const archived = await archiveContact(id);
		if (!archived) throw notFound("联系人不存在或已归档。");

		return { archived: true };
	}),
);
