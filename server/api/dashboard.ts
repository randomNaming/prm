import { dashboard } from "../utils/dashboard";
import { guarded } from "../utils/guard";

export default defineEventHandler(() => guarded(async () => dashboard()));
