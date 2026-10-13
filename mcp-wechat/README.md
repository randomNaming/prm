# mcp-wechat

一个独立的微信聊天记录 MCP Server。它读取你导出的纯文本聊天记录，通过 MCP 协议把聊天数据供给任意 MCP 客户端（Claude Desktop、Cursor、ZCode 或其他 agent）。

## 这是什么

- 只读服务：读取 `WECHAT_EXPORT_DIR` 目录下的 `.txt` 导出文件，回答查询，不写任何文件。
- 无存储：不建数据库、不建索引文件、不上传、不出网。聊天原文始终只存在于你自己的导出文件里。
- 纯数据输出：三个工具只回传昵称、方向、原文、时间。服务不做总结、不做推断、不做猜测，分析交给接入的 agent。
- 两个传输：stdio（默认，本机使用）与 Streamable HTTP（可选，设置 `MCP_HTTP_PORT` 后启用）。

## 为什么独立于 CRM（一句话）

本包不导入 CRM 的任何代码、配置或数据库，只依赖 `@modelcontextprotocol/sdk`、`zod`、`dotenv`，因此可以整体复制到另一个仓库单独交付、单独运行。

## 环境要求

- Node.js 20 或更高版本（构建产物用 `node dist/index.js` 运行）。
- 安装依赖与测试需要 bun 1.1 或更高版本。

## 安装、构建、运行

```bash
cd mcp-wechat
bun install
bun run build
cp .env.example .env      # Windows: copy .env.example .env
# 编辑 .env，至少填写 WECHAT_EXPORT_DIR
node dist/index.js         # stdio 模式，等待 MCP 客户端连接
```

设置 `MCP_HTTP_PORT` 后同一条命令改为启动 Streamable HTTP：

```bash
MCP_HTTP_PORT=3939 node dist/index.js
```

也可以全局安装后作为命令运行（`package.json` 里有 `bin` 入口）：

```bash
npm install -g .
mcp-wechat
```

`package.json` 的脚本：

| 脚本 | 作用 |
| --- | --- |
| `bun run build` | `tsc -p tsconfig.json`，把 `src/` 编译到 `dist/` |
| `bun run start` | `node dist/index.js` |
| `bun test` | 运行全部测试 |

## 配置项（.env）

配置从「本包目录下的 `.env`」或同名进程环境变量读取。进程环境变量优先（`.env` 只补缺，不覆盖）。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `WECHAT_EXPORT_DIR` | 是 | 微信聊天记录导出文件所在目录的绝对路径。只读该目录下的 `.txt` 文件，忽略其他扩展名。 |
| `MCP_HTTP_PORT` | 否 | 设置后启用 Streamable HTTP，监听端口。必须是 1–65535 的整数。留空或删除 = 只用 stdio。值非法时服务打印中文警告并回退 stdio，不退出。 |

HTTP 模式只绑定 `127.0.0.1`（本机回环）与路径 `/mcp`。**要对公网暴露，必须前置反向代理并配置认证**（Basic Auth 或更强），不要在公网上直接暴露该端口。

## 导出文件格式（解析规则）

服务按下面的规则解析 `.txt` 文件，对空行与行尾空白完全容忍。

### 样例

```
2024-05-01 09:12:03 张三
你好，项目进展如何？
第二行也属于同一条消息

2024-05-01 09:15:20 我
已经发了报价单

[2024/05/02 10:30:00] 张三: 收到，我看看
2024-05-02 11:00:05 我：报价单里含税吗？
```

### 规则

1. **消息头**：一行以 `YYYY-MM-DD HH:mm:ss` 开头，后面跟发送者名字，这一行就是一条新消息的开始。同时接受 `YYYY/MM/DD HH:mm:ss` 与方括号写法 `[2024-05-02 10:30:00]`。
2. **消息体**：从消息头之后直到下一个消息头之前的每一行，都属于这条消息。空行不会打断消息。
3. **同一行写法**：`2024-05-01 09:12:03 张三: 正文`，冒号可用半角 `:` 或全角 `：`。
4. **本人方向**：发送者是 `我`、`自己`、`me`、`Me`、`我(自己)`（也接受全角括号 `我（自己）`）时 `direction` 为 `out`；其他任何发送者都是 `in`。比较时不区分大小写。
5. **时间输出格式**：统一输出为 `YYYY-MM-DD HH:mm:ss`。
6. **文件范围**：只解析扩展名为 `.txt` 的文件（不区分大小写）。子目录不递归。
7. **容错**：无法解析的行被跳过并计数，绝不因为一行坏数据抛错。计数出现在启动日志与 `list_chats` 的索引统计里。

### 会话昵称（person）的确定顺序

按顺序取第一个成立的来源：

1. 文件中第一个消息头之前的声明行，例如 `聊天对象：张三` 或 `与张三的聊天记录`。
2. 文件名：`与张三的聊天记录.txt` → `张三`；`张三的聊天记录.txt` → `张三`；`chat_张三_2024.txt` → `张三`；`张三_2024.txt` → `张三`；`张三.txt` → `张三`。
3. 文件名是通用词（`记录`、`聊天记录`、`微信`、`chat`、`wechat`、`export`、`messages`、`log` 等）时不带昵称，改用该文件中**唯一**的非本人发送者。
4. 文件里有多个非本人发送者时，昵称取文件名，每条消息各自保留真实 `sender`。

同一个昵称出现在多个文件时，这些文件的消息合并为一个会话，`file` 字段用 `, ` 连接多个文件名。

### 已知的解析边界

- 最后一个消息头之后的所有行都属于最后一条消息，包括结尾的导出工具水印行。
- 消息体内的换行原样保留（CRLF 文件的消息体内是 `\r\n`），只去除首尾空白。
- 单个文件超过 256 MiB 时跳过该文件并在 stderr 说明。
- 时间戳必须是真实存在的日期（`2024-02-30` 不算消息头）。

## 三个工具的输出 schema

三个工具的返回值都是 JSON。每个工具的 `content[0].text` 是一个 JSON 字符串，直接 `JSON.parse` 即可。

**字段稳定性承诺：字段只增不改。** 已发布的字段永远不会被重命名或删除；后续版本只会追加新字段。接入方可以安全地按现有字段名解析。

### `list_chats()`

无入参。返回一个 JSON 数组，按 `person` 升序（按 Unicode 码位比较，与系统区域设置无关）。

```json
[
  {
    "person": "张三",
    "file": "与张三的聊天记录.txt",
    "messages": 4,
    "firstAt": "2024-05-01 09:12:03",
    "lastAt": "2024-05-02 11:00:05"
  }
]
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `person` | string | 会话对方昵称。 |
| `file` | string | 来源文件名（多个文件合并时用 `, ` 连接）。 |
| `messages` | integer | 该会话被解析出的消息条数。 |
| `firstAt` | string \| null | 最早一条消息的时间，格式 `YYYY-MM-DD HH:mm:ss`。会话为空时为 `null`。 |
| `lastAt` | string \| null | 最晚一条消息的时间。会话为空时为 `null`。 |

### `search_messages(person, keyword?)`

| 入参 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `person` | string | 是 | 必须与 `list_chats` 返回的 `person` 完全一致。 |
| `keyword` | string | 否 | 纯子串关键词。省略或留空 = 不过滤。 |

匹配规则只有一条：把消息原文与关键词都转成小写后做 `includes` 子串比较。不做模糊匹配、不做拼音、不做同义词、不做分词。

```json
{
  "person": "张三",
  "keyword": "报价",
  "count": 2,
  "truncated": false,
  "availablePeople": ["张三", "李四"],
  "messages": [
    {
      "person": "张三",
      "direction": "out",
      "sender": "我",
      "text": "已经发了报价单",
      "at": "2024-05-01 09:15:20"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `person` | string | 请求的昵称，原样回显。 |
| `keyword` | string \| null | 生效的关键词；未过滤时为 `null`。 |
| `count` | integer | 本次返回的消息条数，等于 `messages.length`。 |
| `truncated` | boolean | 是否因为达到单次上限而被截断。达到上限时只返回前若干条。 |
| `availablePeople` | string[] | 当前索引里全部可用昵称。昵称不存在时用它提示接入方。 |
| `messages` | object[] | 命中的消息，按时间升序。每条字段见下表。 |

### `get_recent(person, limit)`

| 入参 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `person` | string | 是 | 必须与 `list_chats` 返回的 `person` 完全一致。 |
| `limit` | integer | 否 | 1–500 之间的整数，省略时默认 20。 |

```json
{
  "person": "李四",
  "limit": 2,
  "count": 2,
  "availablePeople": ["张三", "李四"],
  "messages": [
    {
      "person": "李四",
      "direction": "out",
      "sender": "我",
      "text": "有空",
      "at": "2024-06-01 08:05:00"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `person` | string | 请求的昵称，原样回显。 |
| `limit` | integer | 本次生效的条数上限。 |
| `count` | integer | 实际返回的条数。 |
| `availablePeople` | string[] | 当前索引里全部可用昵称。 |
| `messages` | object[] | 最近 `limit` 条消息，按时间升序。 |

### 消息对象（`messages[]` 的元素）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `person` | string | 所属会话昵称。 |
| `direction` | `"in"` \| `"out"` | `in` = 对方写的；`out` = 本人写的。 |
| `sender` | string | 该条消息在导出文件里的原始发送者名。 |
| `text` | string | 消息原文，未做加工。 |
| `at` | string | 时间，格式 `YYYY-MM-DD HH:mm:ss`。 |

### 昵称不存在时

`search_messages` 与 `get_recent` 传入的 `person` 不存在时**不报错**：`messages` 返回 `[]`、`count` 为 `0`，同时 `availablePeople` 列出全部可用昵称。接入方据此改问正确的昵称。

### 入参校验

三个工具的入参都用 Zod 校验。缺 `person`、`limit` 不是 1–500 的整数等情况返回 MCP 工具错误，服务本身不崩溃。

## 隐私边界

- **只读**：只调用 `readdir` / `stat` / `open(..., "r")` / `read`。源码里没有 `writeFile`、`mkdir`、`appendFile`、`rename`、`unlink`。
- **无数据库**：没有 ORM、没有 SQLite、没有索引文件。索引只存在于进程内存里，进程退出即消失。
- **无出网**：源码里没有 `fetch`、没有 `http.request`、没有遥测。唯一的网络对象是 HTTP 模式下本机 127.0.0.1 的监听端口。
- **原文不外流**：聊天原文只在被查询时从你的文件里读出来，直接回给发起调用的 MCP 客户端。
- **无备份需求**：本服务没有任何持久化数据。

## 缺少 `WECHAT_EXPORT_DIR` 时的行为

启动时读不到 `WECHAT_EXPORT_DIR`，服务向 stderr 打印一段简体中文说明并以退出码 `1` 结束。不打印堆栈，不崩溃：

```
错误：未配置必需的环境变量 WECHAT_EXPORT_DIR。
原因：该变量指向微信聊天记录导出文件所在的目录，本服务只读该目录。
修复：在 <包目录>/.env 中写入 WECHAT_EXPORT_DIR=<目录绝对路径>，或直接设置同名环境变量后重试。
```

同样以退出码 `1` 结束的情况：目录不存在、路径指向文件而不是目录、目录无读取权限。目录存在但为空是**正常情况**：服务以 0 个会话启动，三个工具都返回空结果。

## MCP 客户端接入配置

下面两种客户端都覆盖 stdio 与 HTTP 两种模式。把路径换成你自己的绝对路径。

### 一、Claude Desktop（`claude_desktop_config.json`）

配置文件位置：Windows 为 `%APPDATA%\Claude\claude_desktop_config.json`，macOS 为 `~/Library/Application Support/Claude/claude_desktop_config.json`。

**stdio 模式（推荐）**

```json
{
  "mcpServers": {
    "wechat": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\mcp-wechat\\dist\\index.js"],
      "env": {
        "WECHAT_EXPORT_DIR": "C:\\Users\\YourName\\Documents\\微信导出"
      }
    }
  }
}
```

**HTTP 模式**（先在另一个终端用 `MCP_HTTP_PORT=3939 node dist/index.js` 启动服务）

```json
{
  "mcpServers": {
    "wechat": {
      "type": "http",
      "url": "http://127.0.0.1:3939/mcp"
    }
  }
}
```

### 二、Cursor / ZCode 等使用 `mcpServers` 结构的客户端

Cursor 的配置位置：项目内 `.cursor/mcp.json`，或用户级 `~/.cursor/mcp.json`。ZCode 及其他 agent 客户端使用同一套 `mcpServers` 结构。

**stdio 模式**

```json
{
  "mcpServers": {
    "wechat": {
      "command": "node",
      "args": ["C:/Users/YourName/mcp-wechat/dist/index.js"],
      "env": {
        "WECHAT_EXPORT_DIR": "C:/Users/YourName/Documents/微信导出"
      }
    }
  }
}
```

**HTTP 模式**

```json
{
  "mcpServers": {
    "wechat": {
      "type": "http",
      "url": "http://127.0.0.1:3939/mcp"
    }
  }
}
```

如果客户端只支持 stdio，又必须连远程服务，用 stdio 桥接：

```json
{
  "mcpServers": {
    "wechat": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3939/mcp"]
    }
  }
}
```

### 三、验证接入是否成功

连上以后应该看到恰好三个工具：`list_chats`、`search_messages`、`get_recent`。先调用 `list_chats`，再用返回的 `person` 调用另外两个工具。

## 传输模式

| 模式 | 触发条件 | 适用场景 | 暴露面 |
| --- | --- | --- | --- |
| stdio（默认） | 不设置 `MCP_HTTP_PORT` | 本机 MCP 客户端接入 | 无网络暴露 |
| Streamable HTTP | 设置 `MCP_HTTP_PORT` | 内网远程 agent 接入 | 仅 127.0.0.1，路径 `/mcp` |

设置 `MCP_HTTP_PORT` 后服务只启动 HTTP，不再启动 stdio。HTTP 端点接受 `POST`；其他路径返回 404，`GET` 返回 405。服务按请求无状态处理，多个客户端可以同时连接。

公网暴露前必须前置反向代理并加认证，例如 nginx：

```nginx
location /mcp {
    auth_basic "mcp";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:3939/mcp;
    proxy_set_header Host $host;
    proxy_buffering off;
}
```

## 性能与索引

- 启动时扫描目录，建立「昵称 → 文件 + 每条消息的字节偏移」内存索引。启动阶段不把消息原文留在内存里。
- 查询时按需从文件读取所需字节区间，`get_recent` 只读尾部那一段。
- 每个文件按 `mtimeMs` 与 `size` 判断是否变化；变化后自动重建该文件的索引，同时检查文件的新增与删除。检查有节流，避免每次查询都读目录。

## 开发：测试与冒烟

```bash
bun install
bun run build
bun test
```

测试内容：

- `tests/parser.test.ts`：解析器单元测试，覆盖两个会话、多行消息、同一行写法、`我` 为发出方向、无法解析的行、空文件、CRLF、斜杠日期与方括号日期。
- `tests/chat-store.test.ts`：索引、子串检索、昵称不存在、文件变化重建、节流、文件删除、空目录。
- `tests/server.e2e.test.ts`：用官方 SDK 的 `Client` 驱动构建产物，列出并调用三个工具，校验 JSON 载荷。
- `tests/http.e2e.test.ts`：Streamable HTTP 传输端到端。
- `tests/stdio.e2e.test.ts`：用 `Client` + `StdioClientTransport` 以子进程方式驱动 `dist/index.js`。运行环境禁止创建管道时该测试会跳过并打印原因。
- `tests/startup.test.ts`：缺少 `WECHAT_EXPORT_DIR`、目录不存在、路径不是目录均以退出码 1 结束并打印中文。

手动 stdio 冒烟（把一串 JSON-RPC 请求喂给构建产物）：

```bash
WECHAT_EXPORT_DIR=/path/to/导出目录 node dist/index.js < tests/smoke-requests.jsonl
```

## 目录结构

```
mcp-wechat/
  package.json          独立包定义，含 bin 入口
  tsconfig.json         TypeScript 配置，输出到 dist/
  bunfig.toml           bun 安装缓存位置
  .env.example          配置说明模板
  README.md             本文件
  src/
    index.ts            进程入口：读配置、建索引、选传输
    config.ts           唯一的配置模块：全部可调参数与 .env 解析
    user-text.ts        全部面向用户的中文文案
    domain.ts           领域类型与 Zod schema
    parser.ts           txt 解析器：扫描消息头、记录字节偏移
    peer-name.ts        从文件名或首行解析会话昵称
    chat-store.ts       内存索引、按需读段、变更重建
    tools.ts            三个工具的入参与结果 schema
    server.ts           MCP Server 构建、stdio 与 Streamable HTTP 启动
  tests/
    fixtures/           解析器测试用的导出样例
    smoke-requests.jsonl  手动 stdio 冒烟用的 JSON-RPC 请求
```
