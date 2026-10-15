# mcp-crm

CRM 接入用 MCP Server。**只做中转，不做加工。**

它把外部来源（当前是微信聊天记录）的文本**原样**转发给 CRM 平台的 `/api/intake` 端点，由平台侧的智能体负责抽取联系人、公司、字段并写入 CRM。本服务不解析、不改写、不总结、不落盘。

---

## 为什么单独一个包

本包只解决**推的这段**：外部 agent（WorkBuddy 等）拿到聊天记录后，需要一个"MCP 工具"把内容递交给 CRM 平台。
它不解析、不改写、不落盘，转发之外的一切都交给平台侧智能体，因此独立成包，与主项目互不影响。

---

## 快速开始

```bash
cd mcp-crm
bun install
cp .env.example .env      # 填 CRM_BASE_URL
bun run build
```

### 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `CRM_BASE_URL` | 是 | CRM 平台地址，例如 `http://127.0.0.1:3100`。缺失时启动即报中文原因并非零退出，不崩溃。 |
| `CRM_MAX_TEXT_LENGTH` | 否 | 单次转发原文上限，默认 `50000` 字符。超限的工具调用会被拒绝并提示分批。 |
| `MCP_HTTP_PORT` | 否 | 留空 = 仅 stdio（默认）。设置后改为 Streamable HTTP，端点 `/mcp`，只绑定 `127.0.0.1`。 |

---

## 工具

### `import_wechat_chat`

把一段聊天记录原样转发给 CRM 平台。

| 参数 | 类型 | 说明 |
|---|---|---|
| `person` | string (≤64) | 会话对方昵称。平台用它标识这段记录属于谁。 |
| `file` | string \| null (≤191) | 来源文件名。平台会写进证据出处（`evidence.ref`）。 |
| `text` | string (1 ~ `CRM_MAX_TEXT_LENGTH`) | 聊天记录原文。**逐字传入，不要预先改写、翻译或总结。** |

返回：

```json
{
  "delivered": true,
  "accepted": true,
  "person": "许东明",
  "file": "聊天记录.txt",
  "chars": 203,
  "reason": null,
  "platform": {
    "conversation_id": "conv_xxx",
    "summary": "已从这段记录中新建联系人许东明……",
    "counts": { "ensure_contact": 1, "ensure_company": 1, "record_fact": 5 },
    "created_contacts": [{ "id": "ct_xxx", "name": "许东明" }],
    "created_companies": [{ "id": "co_xxx", "name": "深圳市领健（翔铭达）科技有限公司" }]
  }
}
```

字段含义：

- `delivered` — 是否成功把内容送到了平台（网络层）。
- `accepted` — 平台是否成功处理（业务层）。
- `reason` — 失败原因，已中文化，可直接给人看。
- `counts` — 平台侧智能体各工具的调用次数，用于验收时确认"确实干活了"。
- `created_contacts` / `created_companies` — 本次**新建**的记录（已存在的不会出现在这里）。

### `intake_status`

探测 CRM 平台是否在线、智能体是否可用。

```json
{ "reachable": true, "agent_enabled": true, "base_url": "http://127.0.0.1:3100", "reason": null }
```

写入失败前先调它，可以区分三种情况：

- `reachable=false` → 平台没启动，或地址/端口写错。
- `reachable=true, agent_enabled=false` → 平台在跑，但没配 `ZAI_API_KEY`，智能体停用。
- 都正常 → 问题在记录内容本身。

---

## 设计约束（刻意为之）

1. **不做任何加工。** 本包不含解析器，没有正则，不切分消息。改写的责任在调用方或平台侧。未来如果要做前置加工，应该加一个独立的、可选的加工层，而不是把逻辑塞进这个包。
2. **不落盘。** 收到的文本只在一次 HTTP 请求的生命周期内存在，转发完即释放。
3. **不重试。** 失败就如实返回 `delivered: false` 与原因，由调用方决定是否重发。避免在不确定状态下的重复建档。
4. **不批量。** 一次调用处理一段记录。长记录由调用方按时间顺序拆批，依次调用。这样失败时能精确定位是哪一批。
5. **只增不改的返回契约。** 平台返回的字段只会增加，不会改名或删除；本包对未知字段做宽松解析。

---

## WorkBuddy 侧配置（stdio）

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

配置后需在连接器管理页对该 server 点「信任」才会生效。

---

## 本地验证

不依赖真实 CRM 平台与数据库：

```bash
# 终端 1：假平台
node scripts/stub-crm.mjs 3999

# 终端 2：冒烟
CRM_BASE_URL=http://127.0.0.1:3999 node scripts/smoke.mjs
```

冒烟脚本会依次验证：MCP 握手、工具列表、状态探测、正常转发、超长拒绝。

---

## 目录

```
mcp-crm/
├── src/
│   ├── index.ts       入口：读环境变量，决定 stdio 还是 HTTP
│   ├── config.ts      APP 常量、环境变量校验、包身份
│   ├── server.ts      注册工具、stdio 与 Streamable HTTP 传输
│   ├── tools.ts       两个工具的入参 schema 与结果构造
│   ├── client.ts      转发给平台 /api/intake，含错误中文化
│   ├── domain.ts      转发契约与返回结构的 zod schema
│   └── user-text.ts   所有面向人的中文文案（含报错修复指引）
└── scripts/
    ├── stub-crm.mjs   假平台，用于离线验证
    └── smoke.mjs      stdio 冒烟测试
```
