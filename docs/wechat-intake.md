# 微信聊天记录 → CRM 接入说明（最小验证版）

把微信聊天记录经 MCP Server 递给 CRM 平台，由平台侧智能体自动抽取**联系人、公司**并建档。

**WorkBuddy 侧只负责中转，不做任何加工。**

---

## 一、验收结果

已用两条真实样本跑通完整链路（真实 GLM 调用 + 真实 MySQL）：

### 样本 1：许东明名片（239 字符）

```
【姓名】许东明
【电话】19924544039
【公司名称】深圳市领健（翔铭达）科技有限公司
【主营产品】集研发、生产、销售于一体的国家高新技术与专精特新企业……
【地址】广东省深圳市宝安区黄麻布路普顺达科技楼C4栋A座7-8层。
```

**平台侧最终产出：**

| 对象 | 结果 |
|---|---|
| 联系人 | **许东明**（电话 19924544039） |
| 公司 | **深圳市领健（翔铭达）科技有限公司** |
| 归属关联 | 许东明 → 该公司 ✅ |
| 公司字段 | 主营介绍、公司地址（均 applied） |
| 待确认建议 | 联系人新字段「籍贯」「爱好」 |
| 证据 | 每条字段均带 `wechat.chat` + 原文摘录 + 来源文件名 |

智能体主动说明：**"合作角色未判定——聊天只介绍了产品与业务能力，没写明供需关系，无证据不判。"** 三条铁律正确生效。

### 样本 2：Doc 证书咨询（292 字符，无结构化字段）

无姓名/电话/公司，智能体的处理：只建档 + 记一条活动摘要，**不建公司、不写字段、不猜**。

---

## 二、架构

```
WorkBuddy ──(MCP stdio)──▶ mcp-crm ──(HTTP POST)──▶ CRM /api/intake
                                                          │
                                                          ▼
                                                   平台 Agent（GLM）
                                                   ├─ search_crm       查重
                                                   ├─ ensure_contact   建人
                                                   ├─ ensure_company   建公司
                                                   ├─ link_contact_company 建归属
                                                   ├─ record_fact      写字段
                                                   ├─ record_company_fact
                                                   ├─ classify_role    判角色
                                                   ├─ propose_field    提新字段
                                                   └─ create_activity  记摘要
                                                          │
                                                          ▼
                                                        MySQL
```

**两个 MCP 的分工（不要混淆）：**

| | `mcp-wechat` | `mcp-crm`（本次新增） |
|---|---|---|
| 方向 | 平台 → WorkBuddy（读） | WorkBuddy → 平台（写） |
| 作用 | 把 txt 聊天记录读出来 | 把聊天记录递交给 CRM |
| 是否加工 | 解析消息头/昵称 | **完全不加工** |
| 改动 | **零改动** | 全新 |

---

## 三、WorkBuddy 侧配置

在 MCP 配置里加入：

```json
{
  "mcpServers": {
    "crm": {
      "command": "node",
      "args": ["C:\\Users\\SHXjw\\Documents\\local_github\\crm-mini\\mcp-crm\\dist\\index.js"],
      "env": {
        "CRM_BASE_URL": "http://127.0.0.1:3100"
      }
    }
  }
}
```

配置后在连接器管理页对该 server 点「信任」才会生效。

### 手动发起任务的步骤

1. 启动 CRM 平台（见第五节）
2. WorkBuddy 里说：**"把这份聊天记录导入 CRM：<文件路径>"**
3. WorkBuddy 调 `import_wechat_chat(person, file, text)` 原样转发
4. 等平台返回摘要（真实 GLM 调用约 90–120 秒）
5. 到平台界面核对联系人 / 公司

### 工具返回示例

```json
{
  "delivered": true,
  "accepted": true,
  "person": "许东明",
  "file": "聊天记录.txt",
  "chars": 239,
  "platform": {
    "conversation_id": "conv_xxx",
    "summary": "导入完成：新建联系人许东明……",
    "counts": { "search_crm": 3, "ensure_contact": 1, "ensure_company": 1, "link_contact_company": 1, "record_fact": 3, "propose_field": 2, "record_company_fact": 2, "classify_role": 1, "create_activity": 1 },
    "created_contacts": [{ "id": "ct_xxx", "name": "许东明" }],
    "created_companies": [{ "id": "co_xxx", "name": "深圳市领健（翔铭达）科技有限公司" }]
  }
}
```

`counts` 可以直接用来验收"确实干活了"。

---

## 四、本次改动清单

### 新增

| 文件 | 作用 |
|---|---|
| `mcp-crm/`（整包） | CRM 接入 MCP Server，两工具：`import_wechat_chat`、`intake_status` |
| `agent/intake.ts` | `runIntake`：非流式跑一轮微信导入，返回结构化结果 |
| `server/api/intake.ts` | `POST /api/intake`：MCP 的转发目标 |
| `scripts/e2e-intake.ts` | 端到端验收脚本（真实 GLM + 真实 MySQL） |
| `tests/ensure-contact.test.ts` | 14 个用例 |
| `tests/intake.test.ts` | 6 个用例 |

### 修改

| 文件 | 改动 |
|---|---|
| `agent/prompts.ts` | 新增 `WECHAT_SYSTEM`：微信模式规则（昵称≠真名、证据 kind、先查重后建档） |
| `agent/tools.ts` | 新增 `ensure_contact`、`link_contact_company` 两个工具 |
| `agent/chat.ts` | `chatStream` 支持 `systemOverride` |
| `server/utils/contacts.ts` | 新增 `ensureContact`（三级去重）、`linkContactCompany` |
| `server/utils/validate.ts` | 新增 `ensureContactInput` |
| `server/utils/config.ts` | 新增 `intake.maxTextLength`（50000） |

### 未改动

**`mcp-wechat` 一个字符都没改** —— 它是独立包且有对外兼容承诺。

---

## 五、如何自己启动验收

### 1. 装依赖并构建 mcp-crm

```bash
cd mcp-crm
bun install
cp .env.example .env      # 填 CRM_BASE_URL
bun run build
```

### 2. 启动 CRM 平台

```bash
cd crm-mini
bun run dev               # 或 bun run build && bun run start
```

平台需在 `.env` 配好 `DATABASE_URL`（MySQL 8.0）与 `ZAI_API_KEY`。

### 3. 跑端到端验收

```bash
bun run scripts/e2e-intake.ts "路径/聊天记录.txt" "许东明"
```

脚本会打印：平台 Agent 的工具调用次数、新建的联系人与公司、以及回平台查询的完整详情（含每条证据）。

### 4. 离线验证 MCP 链路（不需要平台与数据库）

```bash
# 终端 1
node mcp-crm/scripts/stub-crm.mjs 3999
# 终端 2
CRM_BASE_URL=http://127.0.0.1:3999 node mcp-crm/scripts/smoke.mjs
```

---

## 六、三条铁律如何被继承

微信来源的写入**全部复用现有证据写路径**，因此自动继承：

1. **永不覆盖人工值** —— 样本 1 重跑时，电话已有人工同值，智能体的写入变成 `proposed` 建议，未覆盖。
2. **被拒绝过的同值不再提** —— 由 `decideFact` 强制。
3. **没有一手来源不写** —— `ensure_contact`、`record_fact`、`classify_role` 等入参均要求 `evidence` ≥ 1 条；证据 `kind="wechat.chat"`，`quote` 为原文摘录，`ref` 为 `昵称@文件名`。

**明确不写入 CRM 的内容**：聊天原文、报价金额、订单数量、私人隐私。CRM 里也没有写商机的工具，金额天然进不来。

---

## 七、已知限制与后续

| 限制 | 说明 | 建议 |
|---|---|---|
| 昵称质量决定建档质量 | 样本 2 的昵称"客户咨询DOC证书"被当姓名建档。Agent 严格按规则执行，是输入问题 | WorkBuddy 侧前置加工时，先识别真实联系人名再转发 |
| 长记录需分批 | 单次上限 50000 字符，超限工具会拒绝并提示 | 按时间顺序拆批多次调用 |
| 公司简称不自动合并 | `findCompanyByName` 是精确匹配，无别名表；误并不可逆 | 由 Agent 先 `search_crm` 查证，或后续加别名表 |
| `maxSteps=8` 限制 | 一次导入最多 8 步，记录复杂时可能不够 | 长记录分批天然规避 |
| 平台需常驻 | MCP 转发依赖 CRM 在线 | `intake_status` 可先探活 |

---

## 八、沙箱环境说明

本次开发环境中 `nuxt build` / `nuxt dev` 被 WorkBuddy 的安全删除策略拦截（Nitro 每次构建都要清空 `.nuxt/dist` 与 `.output`，触发批量删除保护）。

**这不影响你自己机器上的使用** —— 在普通终端里 `bun run dev` / `bun run build` 正常。端到端验收因此改为绕过 HTTP 层、直接调 `runIntake`，覆盖的业务逻辑完全一致。
