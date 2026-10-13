import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { runIntake } from "../agent/intake";

const txtPath = process.argv[2];
const text = readFileSync(txtPath, "utf8");
const fileName = basename(txtPath);
const person = process.argv[3] ?? "许东明";

console.log("\n=== 端到端验收（真实 GLM + 真实 MySQL）===");
console.log(`记录文件：${fileName}`);
console.log(`会话昵称：${person}`);
console.log(`记录长度：${text.length} 字符\n`);

console.log("[1] 经平台 Agent 抽取并写库（真实 GLM，请稍候）...");
const started = Date.now();
const result = await runIntake({ person, file: fileName, text });
console.log(`    完成，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
console.log(`    摘要：${result.summary.slice(0, 400) || "（无）"}`);
console.log(`    工具调用次数：${JSON.stringify(result.counts)}`);
console.log(`    新建联系人：${result.created.contacts.map((c) => c.name).join("、") || "（无）"}`);
console.log(`    新建公司：${result.created.companies.map((c) => c.name).join("、") || "（无）"}`);

const { listContacts, contactDetail } = await import("../server/utils/contacts");
const { listCompanies, companyDetail } = await import("../server/utils/companies");
const { searchCrm } = await import("../server/utils/search");
const { closeDb } = await import("../server/utils/db");

console.log("\n[2] 回平台核验：联系人列表（按昵称搜）");
const page = await listContacts({ q: person, page: 1, pageSize: 10, archived: false });
console.log(`    命中 ${page.total} 位联系人`);
for (const c of page.items) console.log(`      · ${c.firstName}${c.lastName ?? ""} (id: ${c.id})`);

console.log("\n[3] 回平台核验：全局子串搜索");
const hits = await searchCrm(person, 20);
for (const h of hits) console.log(`      · [${h.type}] ${h.label}${h.detail ? ` — ${h.detail}` : ""}`);

const targetId = result.created.contacts[0]?.id ?? page.items[0]?.id;
if (targetId) {
  console.log("\n[4] 回平台核验：联系人详情");
  const d = await contactDetail(targetId);
  if (d) {
    const c = d.contact;
    console.log(`    ${c.firstName}${c.lastName ?? ""}`);
    console.log(`      电话=${c.phone ?? "空"}  微信号=${c.wechatId ?? "空"}`);
    console.log(`      地址=${c.address ?? "空"}  业务角色=${c.businessRole ?? "空"}  职位=${c.title ?? "空"}`);
    console.log(`      所属公司=${d.company?.name ?? "未关联"}`);
    console.log(`      字段事实 ${d.facts.length} 条：`);
    for (const f of d.facts.slice(0, 15)) {
      const ev = Array.isArray(f.evidence) ? f.evidence[0] : null;
      console.log(`        · ${f.field} = ${String(f.value).slice(0, 50)} [${f.status}/${f.source}]`);
      if (ev) console.log(`            证据 ${ev.kind}：「${String(ev.quote).slice(0, 70)}」ref=${ev.ref ?? "无"}`);
    }
    console.log(`      活动 ${d.activities.length} 条：`);
    for (const a of d.activities.slice(0, 6)) console.log(`        · [${a.kind}] ${a.title}`);
  }
}

const companyId = result.created.companies[0]?.id;
const companyPage = await listCompanies({ q: "", page: 1, pageSize: 50, archived: false });
console.log(`\n[5] 回平台核验：公司（总数 ${companyPage.total}）`);
const targetCompany = companyId ?? companyPage.items[0]?.id;
if (targetCompany) {
  const d = await companyDetail(targetCompany);
  if (d) {
    const c = d.company;
    console.log(`    ${c.name}`);
    console.log(`      行业=${c.industry ?? "空"}  合作角色=${c.cooperationRole ?? "空"}`);
    console.log(`      公司地址=${c.address ?? "空"}  官网域名=${c.domain ?? "空"}`);
    console.log(`      主营介绍=${(c.description ?? "空").slice(0, 150)}`);
    console.log(`      公司字段事实 ${d.facts.length} 条：`);
    for (const f of d.facts.slice(0, 10)) {
      const ev = Array.isArray(f.evidence) ? f.evidence[0] : null;
      console.log(`        · ${f.field} = ${String(f.value).slice(0, 70)} [${f.status}/${f.source}]`);
      if (ev) console.log(`            证据 ${ev.kind}：「${String(ev.quote).slice(0, 70)}」`);
    }
    console.log(`      关联联系人：${d.contacts.map((p) => p.firstName).join("、") || "无"}`);
  }
}

await closeDb();
console.log("\n=== 验收完成 ===\n");
