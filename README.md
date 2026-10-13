# 极简 CRM（crm-mini）

单人使用的轻量客户管理工具，加一个独立的微信聊天记录 MCP Server。两个交付物互不依赖。

| 交付物 | 目录 | 是什么 |
| --- | --- | --- |
| A · CRM | 本目录 | 单进程 Web 应用：中文界面 + API + 智能体循环 + 后台研究队列，数据存 MySQL 8.0 |
| B · 微信 MCP Server | [`mcp-wechat/`](mcp-wechat/README.md) | 独立进程，只读微信导出文件，经 MCP 协议把聊天数据供给任意 agent |

交付物 B 是首个交付物，可单独运行、单独交付、单独拆库。A 不装也能用 B。

## 环境要求

| 项 | 要求 |
| --- | --- |
| Node.js | 20 LTS 或更高（构建产物用 `node .output/server/index.mjs` 运行） |
| MySQL | 8.0（utf8mb4）。这是 CRM 唯一的外部依赖服务 |
| bun | 1.3 或更高（安装依赖、构建、测试用） |
| 智谱密钥 | 可选。没有它时对话与后台研究停用，界面明示，其余功能照常 |

不用 Docker，不用 Redis，不用消息队列。

## 快速开始

```bash
cd crm-mini
bun install
cp .env.example .env                     # Windows: copy .env.example .env
# 编辑 .env：至少填 DATABASE_URL 与 ZAI_API_KEY（后者可留空）
bun run db:migrate                       # 建库（utf8mb4）+ 建 8 张表
bun run build
node --env-file=.env .output/server/index.mjs   # 单进程启动，地址取自 .env
```

`--env-file=.env` 让监听地址与端口真正取自 `.env`。不加这个参数时进程同样能启动，但 `HOST`、`PORT` 只认操作系统环境变量，忽略 `.env` 里的同名项。监听地址默认就是 `127.0.0.1`，仅本机可访问。

开发模式：`bun run dev`。

### Windows 一键启动

双击 **`start.cmd`**，或者命令行运行它。它会依次做四件事：

1. 检查 Node.js 版本、`.env` 是否存在、`DATABASE_URL` 是否填好；
2. TCP 探测一次 MySQL，连不上就直说是端口没监听、网络不通还是主机名解析失败；
3. `.output/server/index.mjs` 不存在时自动 `nuxt build`；
4. 按 `.env` 里的 `HOST` / `PORT` 启动服务，并打印访问地址。

Windows 上绑定 `0.0.0.0` 会额外提示「同网段的机器都能访问」。

**`start.cmd` 里为什么一个中文都没有。** cmd.exe 是拿控制台代码页（中文 Windows 是 936/GBK）
逐行读批处理文件的，文件里的 UTF-8 中文会被解成乱码，然后当成命令去执行 ——
现象就是满屏 `'嫤锛?set' 不是内部或外部命令`。所以批处理保持纯 ASCII 只做外壳，
中文提示全部由 `scripts/start.mjs` 输出，Node 在 Windows 控制台上按 UTF-16 写，不会乱码。

## 环境变量

全部变量写在仓库根目录的 `.env`（git 忽略），`.env.example` 是它的文档。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | MySQL 连接串，例如 `mysql://user:pass@127.0.0.1:3306/crm_mini`。库不存在时 `db:migrate` 自动创建 |
| `ZAI_API_KEY` | 否 | 智谱 GLM Coding Plan 密钥。留空 = 对话与后台研究停用，界面明示原因，进程不崩溃 |
| `ZAI_BASE_URL` | 否 | 默认 `https://open.bigmodel.cn/api/coding/paas/v4`。这是 Coding Plan 专属端点，通用端点密钥不通用 |
| `ZAI_MODEL` | 否 | 默认 `glm-5.2` |
| `HOST` | 否 | 绑定地址。本地 `127.0.0.1`；内网填内网 IP |
| `PORT` | 否 | 默认 3000 |

## 目录结构

```
crm-mini/
  start.cmd              Windows 双击启动（纯 ASCII 外壳，见上文说明）
  .env.example           环境变量说明
  nuxt.config.ts         Nuxt 3 配置（srcDir=app，serverDir=server）
  drizzle.config.ts      Drizzle 配置（迁移为纯 SQL）
  app/                   Vue 3 界面（Element Plus，简体中文）
    pages/               首页 / 联系人 / 公司 / 商机 / 智能体 / MCP 接入
    components/          表单、字段建议、Agent 对话、列表渲染、列选择器、配置片段
    composables/         接口调用封装、列表列偏好
    utils/               日期与人名格式化、列表列定义
    types/domain.ts      前后端共用的领域类型与中文标签（纯类型，不引入服务端代码）
  server/
    api/                 Nitro 服务端路由（REST）
    db/schema.ts         Drizzle 表定义（10 张表）
    db/migrations/       纯 SQL 迁移
    plugins/background   进程内定时器，随进程启动
    utils/               配置、环境变量、连接池、记录读写、证据写路径、队列、工作器、MCP 接入信息
  agent/                 智能体：模型连接、提示词、工具集、对话循环、后台研究
  mcp-wechat/            交付物 B（独立包，见它自己的 README）
  mcp-crm/               写侧 MCP Server（独立包，见它自己的 README）
  scripts/migrate.mjs    迁移执行器
  scripts/start.mjs      一键启动器（全部中文提示都在这里）
  scripts/backup.sh      mysqldump 在线热备
  tests/                 自动化验收测试
```

## 数据模型

10 张表：`companies`、`contacts`、`deals`、`activities`、`contact_facts`、`company_facts`、`field_defs`、`agent_tasks`、`conversations`、`messages`。

约定：

- 主键统一 `VARCHAR(36)`（cuid2）；时间统一 `BIGINT` 毫秒时间戳；结构化负载用原生 `JSON`。
- 没有 `users` / `sessions` / `organizations`。单人系统没有「谁」的概念。
- `deals.amount` 只存在于数据库层。界面不展示、不录入，接口也不接受这个字段。
- 复查不是独立表，是 `agent_tasks(kind='recheck', run_at=未来)`。
- **微信聊天原文只存在 `messages` 里**（导入会话的那条 `user` 消息），不进 `contacts.notes`、不进 `activities.body`。记录字段里只放抽取出来的值，以及 `evidence.quote` 里的短摘录（≤500 字）。

字段归属：

| 信息 | 落在哪 |
| --- | --- |
| 姓名、职位、邮箱、**电话（主号）**、微信号、**地址**、**业务角色**、**关系维护**、**修复说明**、领英、GitHub | `contacts` 对应列 |
| **手机、家庭电话、工作电话** | `contact_facts`（没有独立列，与自定义字段同一套机制） |
| 公司名、行业、**公司地址**、**合作角色**、官网域名、主营介绍 | `companies` 对应列 |
| 客户原文、微信名片、聊天摘要、跟进记录 | `activities`（`kind='note'`），挂在联系人或公司下 |
| 聊天导入留底 | `conversations` + `messages`，会话通过 `contact_id` 挂到人；时间线上另有一条只读的 `chat_log` 锚点 |
| 备注 | `contacts.notes`，只放你自己写的话，不放客户原文 |
| 自定义字段的值 | `contact_facts` / `company_facts` 的 `field` 存自定义键，没有对应列 |

### 电话为什么要拆成四个字段

原始导出里的号码常常带类型（`Cell: …` / `Home : …`），挤在一个「电话」字段里就只能拼成 `708-557-7187（手机）/ 708-756-0361（家庭）` 这种既不是原文、也没法单独取用的值。所以：

| 字段 | 收什么 |
| --- | --- |
| 电话 | **主号**。没有任何类型标注的号码写这里；标了类型的号码里最适合打电话的那个（优先手机）也写一份到这里，列表和详情一眼能看到要拨的号。 |
| 手机 | `Cell` / `Mobile` / 手机 / 手机号 |
| 家庭电话 | `Home` / 家庭 / 住宅 |
| 工作电话 | `Office` / `Work` / 办公 / 公司电话 / 座机 |

- **`手机` 曾经是 `电话` 的别名**，所以写「手机」会被解析成「电话」，两个号永远拆不开。拆分时把 `手机`、`手机号`、`mobile`、`cell` 从「电话」的别名里摘掉了，这条是这次修正的关键。
- 三个类型字段没有独立数据库列，值与自定义字段一样只存事实表，三条铁律照旧管着。
- 值必须逐字来自原文：不加「（手机）」这类标签，不把两个号码拼进同一条 `value`。

## 界面

- **首页**只有三块：推进中的商机、已逾期任务（可直接勾选完成）、近期活动（最近 20 条）。页首一句问候语加「新建联系人」。
- **联系人 / 公司 / 商机**：列表、详情、新建、编辑、删除（软删除即归档），按名称、邮箱、微信号做子串搜索。搜索只做子串精确匹配，不做模糊匹配与拼音。
- **列表显示哪些字段由你决定**。「显示字段」按钮里勾选，选择记在这台浏览器的 localStorage 上，刷新和下次打开都照旧，「恢复默认」一键还原。
- **列表行尾有删除按钮**。删除是软删除：记录移出列表、不计入关联统计，但数据还在。打开「显示已归档」开关就能看到它们，在那里点「恢复」原样放回。
- **商机阶段**固定六档：初步接触 → 需求确认 → 方案报价 → 谈判 → 成交 / 搁置。阶段变更自动写入活动。
- **关系维护**：给联系人标「关系待修复 / 重点维护 / 暂缓联系」，见下文。留空就是正常关系。
- **记录详情页有 Agent 标签页**：中文提问、中文回答、流式输出，思考过程默认折叠。会话按记录归属，可切换、可回看。
- **MCP 接入页**在 `导航 → MCP 接入`，见下文。
- 顶栏角标显示队列中（待办 + 在跑）的任务数。

### 关系维护：只标例外，不用给每个人打标签

你迟早会遇到这种客户：**现在不值得再花时间，但以后值得** —— 比如 David，计步精度不达标被差评，等他有了精度达标的新品再谈。

这件事**不能塞进商机阶段**：阶段回答的是「这**一单**谈到哪了」，属于单据；而「值不值得再联系」属于客户。把已经成交的单子标成别的，等于把「他买过」这个事实擦掉；而且一个客户可以同时有好几条生意线，标在哪一条上都会含糊。

所以它单独有一个字段，挂在联系人上：

| 关系维护 | 含义 | 修复说明 |
| --- | --- | --- |
| **默认**（不标） | 正常关系。**这一档就是「长期养着」的池子** —— 节日问候、群发营销直接从这里捞人 | 无 |
| 关系待修复 | 出过问题：差评、质量投诉、承诺没兑现 | 选中后才展开，手写要修什么、等到什么条件 |
| 重点维护 | 值得单独用心的大客户，不能只丢进群发 | 无 |
| 暂缓联系 | 客户说别打扰 / 明显淡季 | 无 |

- **「默认」是有含义的一个档位，不是缺数据。** 所以绝大多数客户什么都不用填，天然就在群发池里；你只需要标例外。界面上留空一律显示成「默认」，不显示成 `—`。
- 下拉是 `filterable + allow-create` 的：**直接敲一个新词也能存进去，存过一次下次就在下拉里**（跟「业务角色」一样）。选项表登记在 `field_defs`，所以不用改代码就能长出「老客户返单期」这类新标签。
- **这两个字段智能体不写**（`agentWritable: false`）。关系好不好不是能从聊天里读出来的事实，是使用者的判断；智能体去写只会添乱。
- **「关系待修复」是唯一带联动的一项**，选中它才展开「修复说明」。这个联动关系是界面行为，所以固定写在代码里（`RELATIONSHIP_REPAIR`），前后端与字段种子共用同一个字符串。
- 关系恢复正常（清空或改成别的）时，**过期的修复说明会一并清掉**，不留旧说明误导人。
- 联系人列表上多了「关系维护」筛选（含「默认」一档，值传 `__blank__`），这就是「捞人」的入口；两个字段也都在「显示字段」里可选成列。

**没做的**：到期提醒。因为「等新品」是**条件**不是日期，硬填一个到期日反而是假的。所以这是一张你得主动去翻的名单。

### 列表默认显示哪些字段

默认列是「一眼要用的」，不是「库里有的」：

| 列表 | 默认列 | 可另选 |
| --- | --- | --- |
| 联系人 | 姓名、业务角色、公司、最近更新 | 电话、微信号、邮箱、职位、地址、领英、GitHub、备注、创建时间、最近研究、关系维护、修复说明 |
| 公司 | 公司名、合作角色、行业、联系人、最近更新 | 官网域名、公司地址、主营介绍、来源、创建时间 |

- 「公司」列来自 `contacts.company_id` 的关联查询，没有归属时显示 `—`。
- 「联系人」列是该公司**未归档**的人数，归档一个联系人，这个数就少一个。
- 职位、微信号、邮箱、域名这些短期用不上的字段没有删掉，只是默认不占视野。
- **自定义字段自动成为可勾选的列**。字段在「字段建议」里确认生效后，它的当前值会跟着列表一起返回（只取 `applied` 的事实，待确认的不显示），在「显示字段 → 自定义字段」里勾上就能看。

## 聊天导入留底与增量导入

### 留底一定挂到人身上

`POST /api/intake` 每次导入都会：

1. 把原文原样存成一条 `messages`（`role='user'`，头部带 `【微信聊天记录】对方昵称：…；来源文件：…`）；
2. 跑完后把会话回填到抽出来的那位联系人（`conversations.contact_id`）—— **不回填的话这条会话三个外键全为 NULL，只会落进全局对话，联系人页面上永远翻不到它**；
3. 写一条只读的 `chat_log` 活动当时间线锚点，并给会话标题补上「条数 + 覆盖区间」。

标题形如：

```
微信记录导入：David McGowan（69 条，2026-08-18 ~ 2026-09-11）
```

标题同时充当留底的索引 —— 只读标题就能回答「上次聊到哪天、隔了多久」，不用翻上万字全文，也就不用为这点元信息加列。认不出消息格式的导出（不是逐行带 `[YYYY-MM-DD HH:MM]` 的那种）会优雅退回成只有昵称的标题，不瞎编区间。

联系人详情页的 **聊天留底** 标签页按导入时间倒序列出历次导入，点「查看原文」按需取回全文，只读。活动时间线上的 `chat_log` 条目有「看留底」按钮跳过去。

`stage_change` 与 `chat_log` 是服务端写的只读类型，`POST /api/activities` 会拒绝手工创建 —— 「只读」不只是界面上的约定。

### 增量二次导入（设计已定，暂未实现）

**问题**：二次导出通常会把旧消息一起带回来。每次当新导入处理的话，会重复烧 token、重复刷活动，还可能把同一段话反复提成字段建议。

**做法**（依赖导出格式，等有第二份真实导出再落地）：

1. **身份**：一个联系人一条「聊天档案」会话，按 `(contactId, 来源)` 复用，二次导入往同一条档案里追加，不散成 N 条。
2. **去重**：解析成一行一条消息，每行算指纹（时间 + 发送方 + 正文摘要），导入时先过滤掉库里已有的，**只把新增行交给模型**。
3. **无新增就零成本返回**：过滤完是空的，直接回「本段无新增」，不调用模型、不写活动。
4. **区间照旧**：每次导入记自己的覆盖区间，二次激活时先看时间差，再决定要不要翻全文。

字段更新不需要额外逻辑：新信息写空字段，撞上人工值就退化成建议，三条铁律已经覆盖。

**这一版已经把第 1 和第 4 条的地基放进去了**（会话回填 + 每次导入一条带区间的只读留底）。第 2、3 条要等导出格式确定后再补，届时不用改数据模型。

## 智能体

- 智谱官方直连（AI SDK + OpenAI 兼容接口），无任何中转网关。正文与 `reasoning_content` 分别流式推送。
- 工具集：`read_contact`、`read_company`、`read_deal`、`search_crm`、`record_fact`、`create_activity`、`schedule_recheck`。入参用 Zod 校验。
- 单轮工具步数上限 8 步，超限优雅终止。
- 一期数据边界：只依据 CRM 库内数据回答；没有联网检索，没有微信数据。查不到就说「无证据」。

### 证据写路径（唯一写入通道，联系人与公司各一条）

联系人用 `record_fact`，公司用 `record_company_fact`。两条通道都由服务端强制同样的三条铁律：

1. **永不覆盖人工录入的值**。字段已有值时只存为建议，等人在界面上接受或拒绝。
2. **被拒绝过的同一个值不再提**。值比较做归一化：忽略大小写与首尾空白，URL 去掉协议、`www.`、尾斜杠与查询串。
3. **没有一手来源不写**。每条事实必须带来源类型与库内原文摘录。

可写字段：

| 通道 | 字段 |
| --- | --- |
| 联系人 | 职位、邮箱、电话、手机、家庭电话、工作电话、微信号、地址、领英、GitHub |
| 公司 | 行业、主营介绍、公司地址、官网域名 |

判断字段当前值是不是人工录入的办法：看同一字段有没有一条 `applied` 的事实且值与字段相同。相同则视为智能体自己写的，可以被新值替换；不同则视为人工值，只生成建议。

公司不存在时，智能体可以先用 `ensure_company` 按全名建一条只有名称的空壳（名称必须逐字来自库内原文），再用 `record_company_fact` 补字段。`ensure_company` 从不修改已存在的公司。

### 字段表与自定义字段（数据长出新字段）

字段不是写死在代码里的，而是登记在 `field_defs` 表：作用域（联系人 / 公司）、键、中文名、别名数组、来源（内置 / 智能体 / 人工）、状态（生效 / 待确认 / 已拒绝）。

- 内置字段在迁移 `0003` 里一次种子写全，并带中英别名。例如 `电话` 的别名有 `手机`、`手机号`、`联系电话`、`联系方式`、`phone`、`telephone`、`mobile`、`tel`、`cell`。
- 智能体遇到字段表里没有的信息时，调 `propose_field` 提一个新字段建议，同时给出示例值与原文证据。
- 提交前做同义词去重：先归一化（忽略大小写、首尾空白、全角半角、空格与标点），再比对键、中文名与全部别名。撞到已有字段就回「已有字段」，不新建。撞到另一个作用域的字段（例如联系人资料里的「行业」）就回「这是公司字段」，让智能体写对地方。
- **新字段要人在界面上确认后才生效**。确认时示例值会带证据写入该记录，来源标记为人工，后续智能体不能覆盖它。被拒绝过的字段名不再被提议。
- 自定义字段的值只存在事实表里（没有对应列），三条铁律与内置字段完全一致：人工确认过的值不会被智能体覆盖。

界面上，「字段建议」标签页分成两块：上面是**新字段建议**，下面是**字段值建议**；自定义字段生效后直接出现在记录详情的基本信息里。

### 角色：合作角色与业务角色

角色不靠自由文本，走分类器：

| 字段 | 作用域 | 默认标签 | 谁写 |
| --- | --- | --- | --- |
| 合作角色 | 公司 | 客户、供应商 | 你手动选，或 `classify_role` 判定 |
| 业务角色 | 联系人 | 对接人、决策人、技术、老板、采购 | 你手动选，或 `classify_role` 判定 |

- 两个字段都是枚举，选项表**没有写死的「其他」**。新标签靠增量维护：你在表单里直接输入一个新词就进选项表；分类器判定出资料里的新角色也会加进去。
- 分类器在 `agent/role-classifier.ts`。它只做三件事之一：命中现有标签、判定为不足以判断（什么都不写）、给出一个新标签。
- 分类按作用域判定：公司资料里的「源头厂家」不会算到联系人头上；联系人资料里的「负责对接」不会算到公司头上。
- 分类结果照走三条铁律。人工已经定过角色时，分类结果只变成建议。
- **换专业分类模型只需替换一个实现。** `roleClassifier()` 现在返回大模型实现。以后接 TypeSafe 的 Jev（`choice` 原语，2–6 选一）时，实现同一个 `RoleClassifier` 接口即可，其它代码不动。

## 后台研究（行即队列）

- 触发点写一行 `agent_tasks`：新建联系人（`research_contact`）、新建公司（`research_company`）、复查到期（`recheck`）、详情页点「重新研究」（`POST /api/research`）。
- 进程内定时器每 60 秒认领到期任务。认领在事务里用 `SELECT … FOR UPDATE SKIP LOCKED`，把行置为 `running` 并写 5 分钟租约。
- 失败时 `attempts` 加一，回到 `pending` 等下一轮；达到 3 次置 `failed` 并把错误写进 `error`。
- 进程重启后，租约过期的 `running` 行自动回到 `pending` 重跑。
- 限速每分钟最多 3 个研究任务，避免烧尽订阅额度。
- 浏览器关闭照常运行；界面只显示队列状态。

所有可调参数集中在 `server/utils/config.ts` 一个 `as const` 对象里。

## 命令行

| 命令 | 作用 |
| --- | --- |
| `start.cmd` | Windows 一键启动：预检 → 必要时构建 → 启动（中文提示由 `scripts/start.mjs` 输出） |
| `bun run dev` | 开发模式 |
| `bun run build` | 构建到 `.output/` |
| `node --env-file=.env .output/server/index.mjs` | 单进程运行，地址与端口取自 `.env` |
| `bun run db:migrate` | 建库并应用 `server/db/migrations/*.sql` |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun test tests` | 运行 CRM 的自动化验收测试 |
| `bash scripts/backup.sh` | mysqldump 在线热备，默认保留 14 天 |

## 测试与验收对应关系

`tests/` 里的测试直接对应需求文档的验收项。测试会清空它连上的那个库里的表，所以**必须指向一个独立的测试库**，不要指向正在用的库。

```bash
# 一次性的准备（用有权限的账号执行）
CREATE DATABASE crm_mini_test DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
GRANT ALL PRIVILEGES ON crm_mini_test.* TO 'crm_user'@'%';

# 每次跑测试
DATABASE_URL='mysql://crm_user:密码@主机:端口/crm_mini_test' bun run db:migrate
DATABASE_URL='mysql://crm_user:密码@主机:端口/crm_mini_test' bun test tests --path-ignore-patterns="mcp-wechat/**"
```

进程环境变量优先于 `.env`，所以上面这条命令不会碰到 `.env` 里的正式库。测试会拉起构建产物（`.output/server/index.mjs`），所以先跑一次 `bun run build`。

| 测试文件 | 覆盖的验收 |
| --- | --- |
| `tests/api.test.ts` | M1 全部：新建联系人 10 秒内进列表、子串搜索无近似扩展、逾期任务勾选、首页只有三块、六阶段、无金额无登录、密钥缺失降级 |
| `tests/pages.test.ts` | 页面渲染：简体中文、无金额、导航齐全、详情页四个区都在 |
| `tests/facts.test.ts` | FR-6 三条铁律的完整用例，含归一化比较与接受建议后关闭冲突建议 |
| `tests/company-facts.test.ts` | 公司事实通道的三条铁律，以及联系人地址字段 |
| `tests/fields.test.ts` | 字段登记表：中英别名去重、跨作用域路由、新字段确认后才可写、自定义字段守铁律 |
| `tests/roles.test.ts` | 合作角色与业务角色：默认标签、增量标签、分类器三条分支、分类器不可用时不写、人工值不被覆盖 |
| `tests/queue.test.ts` | FR-5：认领与租约、租约过期回收、重试 3 次后 failed、复查到期重新入队 |
| `tests/research.test.ts` | 自动研究：空字段直接写入、人工值只生成建议、安排复查、无证据不硬凑、公司研究补公司字段 |
| `tests/agent.test.ts` | FR-4：流式正文与思考过程、工具真实执行、历史上下文、密钥缺失不抛错、步数上限 8 |
| `tests/api-research.test.ts` | M3 端到端：新建联系人后不点击任何按钮，两分钟内自动完成研究 |
| `tests/lists.test.ts` | 列表字段与删除：跨表列（公司名 / 联系人数）、自定义字段进 `facts`、待确认值不进列表、归档与恢复、MCP 接入信息 |

**已知问题：测试之间不隔离。** 所有测试文件共用同一个测试库，且默认跑在同一个进程里，
相互之间会 `TRUNCATE` 对方的表、共享 `process.env`。整套一起跑会出现若干「数据被清空」式的失败，
但这些用例**单独跑都能过**。另外 `queue.test.ts` 里「模型端点失败时任务回到 pending」一条依赖
重试耗时，偶尔会超过 bun 默认的 5 秒上限。排查某个文件时请单独指定文件路径：

```bash
DATABASE_URL='mysql://crm_user:密码@主机:端口/crm_mini_test' bun test tests/lists.test.ts
```

`tests/stub-model.ts` 是一个本地 OpenAI 兼容的假模型服务，用来在没有任何真实密钥的情况下验证整条链路。

## MCP 接入（平台内提示页）

导航里的 **MCP 接入** 页把两个 MCP Server 的接入信息摆在一处，不用再去翻两个包的 README：

- 每个包的**当前状态**：目录在哪、`dist/index.js` 编译了没有、包内 `.env` 建了没有。
- **配置项现状**：`WECHAT_EXPORT_DIR`、`CRM_BASE_URL`、`MCP_HTTP_PORT` 各自的值与来源
  （进程环境变量 / 包内 `.env` / 未配置）。进程环境变量优先于包内 `.env`，与两个包自己的读取规则一致。
- **可直接粘贴的客户端配置**：stdio 与 Streamable HTTP 两种模式各一段 JSON，路径按当前部署算好，
  点「复制」即用。缺配置时还会给出「先执行哪几条命令」和阻塞原因。
- 两个包各自暴露的工具清单。

页面数据来自 `GET /api/mcp`，实现是 `server/utils/mcp.ts`。它只读盘、不启动任何子进程，
所以打开页面不会有副作用，也不依赖这两个包能不能跑起来。

不装 MCP 客户端也能写入：`POST /api/intake` 与 `mcp-crm` 的 `import_wechat_chat` 走同一条智能体抽取链路。

## 部署三阶段

| 阶段 | 做法 |
| --- | --- |
| ① 本地（默认） | `HOST=127.0.0.1`，仅本机可访问 |
| ② 内网 | `HOST=<内网 IP>`，只对可信网段开放 |
| ③ 公网 | **必须**前置反向代理并加认证（Basic Auth 或更强）。进入前单独评审 |

systemd 常驻示例：

```ini
[Unit]
Description=crm-mini
After=network.target

[Service]
WorkingDirectory=/srv/crm-mini
ExecStart=/usr/bin/node /srv/crm-mini/.output/server/index.mjs
EnvironmentFile=/srv/crm-mini/.env
Restart=always
User=crm

[Install]
WantedBy=multi-user.target
```

pm2 也可以：`pm2 start .output/server/index.mjs --name crm-mini`。

nginx 反向代理加认证示例：

```nginx
location / {
    auth_basic "crm";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_buffering off;
}
```

`proxy_buffering off` 是必须的，否则流式回答会攒到最后一次性吐出。

## 备份与恢复

```bash
bash scripts/backup.sh                      # 生成 .data/backups/crm-mini-<时间>.sql.gz
gunzip -c backup.sql.gz | MYSQL_PWD='***' mysql --host=127.0.0.1 --user=crm_user crm_mini
```

`mysqldump --single-transaction` 是在线热备，备份期间不用停服。用 crontab 每天跑一次即可。

## 明确不做的事

- 登录、注册、会话、用户、角色、多租户
- 演示模式与演示数据
- Google、Slack、HubSpot 等连接器
- 网站访问追踪与表单采集脚本
- 金额看板、业绩图表、汇率与多币种
- CRM 内的任何微信导入界面（微信数据只经交付物 B 流通）
- 二期项目：Microsoft 邮箱同步、CRM 接入微信 MCP Server
