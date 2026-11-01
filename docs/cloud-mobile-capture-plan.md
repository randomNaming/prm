# crm-mini 上云 + 手机写入管道：实施方案

> 状态：**方案稿，未改任何代码**。
> 前置决策（已确认）：国内公网 VPS；域名已备案（可直接走 80/443）；手机端 OCR 优先，云端视觉手动触发；原始资料直接写入，联网调研资料必须人工逐项审核，未审核不进 agent 语料但人工可读。
> 衔接文档：[mobile-access-and-transport-security.md](./mobile-access-and-transport-security.md)（威胁模型与认证必要性的论证，本方案不再重复）。

---

## 一、结论

**可行，但这里要建的是「手机写入管道 + 审核网关」，不是「把现有 crm-mini 搬到 VPS」。**

把进程搬上去只会得到一台**没有门、没有上传口、没有识别能力**的机器。真正的增量在四件事：

1. 一台公网机器上的**门**（单用户 + 一设备一 token + TOTP）；
2. 一条**手机拍照 → 识别 → 落库**的通路；
3. 一套**加密存储与可恢复备份**；
4. 一个**人工审核闸门**，把「联网调研结论」和「一手资料」区分开。

**对生态的铺垫，只能算三成。** 能复用的是「服务化 + 鉴权 + 加密 + 备份 + 数据入口」这套骨架，天枢/玉衡的记忆与意图层不在此列，而且会引入**云 CRM + 本地记忆双中心**。这一点在第八节单独说清。

---

## 二、现状核查（基于当前代码）

| 项 | 现状 | 位置 |
| --- | --- | --- |
| 接口数量 | **27 个路由文件**，全部无鉴权 | `server/api/**` |
| 认证 | 无 | `server/middleware/` 目录不存在 |
| 统一包装 | `guarded()` 只包错误，不校验身份 | `server/utils/guard.ts` |
| 监听地址 | 默认仅本机 | `server/utils/env.ts` 的 `HOST=127.0.0.1` |
| 安全头 / CORS / 限流 | 均无 | `nuxt.config.ts` 无 `routeRules` |
| 上传能力 | **无**。`intake` 只收文本（50,000 字上限） | `server/api/intake.ts` |
| 图像能力 | **无**。依赖里没有 sharp / OCR / 视觉 SDK | `package.json` |
| 视觉模型 | **未配置**，只配了 chat model | `agent/model.ts` |
| 「research」 | **不是联网调研**，是把已有记录重新抽取一遍 | `server/api/research.ts` |
| 人工裁决 | **已有成熟范式**：`accept / reject / revert` | `fact-decision.ts`、`field-decision.ts`、`activity-decision.ts`、`promise-decision.ts` |
| MCP | **写侧 only**，且客户端不带任何凭证 | `mcp-crm/src/client.ts` |
| 备份 | `mysqldump` 脚本存在，**未加密、未定时** | `scripts/backup.sh` |
| 测试 | `bun test` 会 **TRUNCATE 所连数据库** | README |

**一句话**：它现在是「只有本机能进、只有一个人用、只能打字」的工具。上云要补的，是这三条边界。

---

## 三、目标架构

```
手机（PWA / iOS 快捷指令 / 系统分享）
   │  ① 拍照，端上 OCR（iOS Vision / Android ML Kit）→ 纯文本
   │  ② 可选：原图加密上传
   ▼
Nginx（443，已备案域名，proxy_buffering off）
   │  安全头 / 限流 / 体积上限
   ▼
Nuxt (127.0.0.1:3000, systemd)
   ├─ middleware/auth.ts  ← 设备 token（可吊销）+ TOTP 签发
   ├─ /api/capture/*      ← 上传、识别结果、视觉触发
   ├─ 现有 27 个接口       ← 全部挂鉴权
   ├─ agent_tasks 队列     ← 抽取（沿用三条铁律）
   └─ 只读接口 / MCP      ← 供 agent 读取（P3）
        │
        ├── MySQL 8（列级加密：聊天原文 / 电话）
        ├── 对象目录 data/objects（AES-256-GCM，EXIF 已剥离）
        └── 备份 → age 加密 → 异地
```

**几个刻意的取舍：**

- **不引入对象存储服务（OSS/COS）**。单机 VPS + 本地加密目录，复杂度最低；数据量上来再迁，接口不变。
- **不做端到端加密**。服务端要跑抽取 agent，看不到明文这套能力就没了（已在评审文档第三节论证）。
- **不重写 UI**。现有 Element Plus 页面加响应式即可，小程序留到以后。

---

## 四、数据模型变更

只新增，不改现有 11 张表。新增 3 张。

### 4.1 `device_tokens`

```sql
CREATE TABLE device_tokens (
  id           CHAR(36)     PRIMARY KEY,
  label        VARCHAR(64)  NOT NULL,           -- "iPhone 15" / "MacBook"
  token_hash   CHAR(64)     NOT NULL UNIQUE,    -- sha256(token)，库里不存明文
  created_at   DATETIME     NOT NULL,
  last_seen_at DATETIME     NULL,
  last_ip      VARCHAR(45)  NULL,
  revoked_at   DATETIME     NULL
);
```

### 4.2 `captures`（一次采集的元数据）

```sql
CREATE TABLE captures (
  id           CHAR(36)     PRIMARY KEY,
  source       ENUM('pwa','shortcut','share','upload') NOT NULL,
  kind         ENUM('card','brochure','pdf','audio','text') NOT NULL,
  ocr_text     MEDIUMTEXT   NULL,               -- 端上 OCR 结果
  vision_text  MEDIUMTEXT   NULL,               -- 云端视觉结果（手动触发才有）
  object_key   VARCHAR(255) NULL,               -- 加密原图路径，可为空
  object_bytes BIGINT       NULL,
  sha256       CHAR(64)     NULL,               -- 去重
  status       ENUM('uploaded','recognized','extracted','failed') NOT NULL,
  error        TEXT         NULL,
  created_at   DATETIME     NOT NULL
);
```

### 4.3 `research_facts`（联网调研结论，带审核状态）

```sql
CREATE TABLE research_facts (
  id             CHAR(36)   PRIMARY KEY,
  subject_type   ENUM('contact','company') NOT NULL,
  subject_id     CHAR(36)   NOT NULL,
  claim          TEXT       NOT NULL,           -- 一条结论一句话，便于逐项判真假
  evidence_url   TEXT       NULL,               -- 必须给出来源
  evidence_quote TEXT       NULL,               -- 原文摘录
  confidence     TINYINT    NULL,
  status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  agent_task_id  CHAR(36)   NULL,
  created_at     DATETIME   NOT NULL,
  reviewed_at    DATETIME   NULL,
  review_note    TEXT       NULL,
  KEY idx_subject_status (subject_type, subject_id, status)
);
```

**硬约束（写进代码，不靠自觉）：**

- agent 检索语料时，**只 join `status='approved'`**；`pending` 与 `rejected` 永不返回给 agent。
- 人工页面按 `status` 分栏展示，全部可读。
- 无 `evidence_url` 的 claim 不允许进入 `approved`（服务端校验）。
- 不复用现有 `facts` 表，避免污染一手资料。

---

## 五、P0：硬化（不碰公网就能做，先做这个）

目标：**在机器公网暴露之前，先把门装好。** 顺序不能反。

### 5.1 认证中间件

新增 `server/middleware/auth.ts`，放在中间件层而不是逐个接口加，27 个接口才不会漏。

- 凭证：`Authorization: Bearer <token>`，token 为 32 字节随机值的 base64url。
- 服务端只存 `sha256(token)`，按 hash 查 `device_tokens`，命中且 `revoked_at IS NULL` 才放行。
- 放行后写入 `event.context.deviceId`，异步更新 `last_seen_at` / `last_ip`。
- **白名单**（唯一的例外）：`/api/health`、静态资源、`/api/auth/login`。其余一律拒绝。
- 失败返回 401，且**不区分**「token 不存在」与「token 已吊销」。

### 5.2 签发与吊销

- `POST /api/auth/login`：主密码（argon2 存 hash）+ TOTP 6 位 → 签发新设备 token，有效期 90 天，返回一次明文（之后不可再取）。
- `POST /api/auth/devices`：列出设备，返回 label / last_seen / last_ip。
- `POST /api/auth/revoke`：按 id 吊销，立刻生效（每次请求都查库，不做内存缓存）。
- TOTP 密钥存 `.env` 之外的 `data/secrets/totp.key`（权限 600），首次登录时绑定。

> 单人系统不需要 refresh token 那套。**长有效期 token + 可吊销列表**足够，且手机端体验最好。

### 5.3 边界防护

| 项 | 落点 | 做法 |
| --- | --- | --- |
| HTTPS | Nginx | 已备案域名 + Let's Encrypt；HTTP 301 到 HTTPS；HSTS |
| 安全头 | Nginx 或 `routeRules` | `X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy`、`X-Robots-Tag: noindex` |
| 限流 | Nginx `limit_req` | 全局 10 r/s；`/api/auth/login` 单独 5 r/min |
| 上传体积 | Nginx `client_max_body_size` | 单文件 20 MB，单次请求 25 MB |
| 流式 | Nginx | `proxy_buffering off`（现有 SSE 必需，README 已有说明）|
| 绑定 | systemd + `.env` | 应用只监听 `127.0.0.1:3000`，公网只开 443 |
| 日志 | 应用 | 不打印聊天原文、token、电话；仅记录 id 与耗时 |

### 5.4 两个必须同步改的地方

1. **`mcp-crm/src/client.ts`** 目前只带 `content-type`。加鉴权后，它必须读环境变量 `CRM_TOKEN` 并带 `Authorization`。这是最容易漏、漏了就整条写入链路断掉的一处。
2. **测试库隔离（硬性）**：`bun test` 会 TRUNCATE 所连库。上云后生产库绝不能在同一条 `DATABASE_URL` 上跑测试。做法：测试脚本强制要求 `DATABASE_URL` 含 `_test` 后缀，否则直接退出；生产 `.env` 单独文件、单独权限。

### 5.5 P0 验收

- 未带 token 访问任一 `/api/*` → 401，且响应体内不含任何业务字段。
- 手机与电脑各自 token，吊销其一，另一台仍正常。
- 登录连续错 5 次被限流。
- `bun test` 在指向生产库时**拒绝执行**。
- `mcp-crm` 带新凭证后 `import_wechat_chat` 仍成功。

---

## 六、P1：最小闭环（名片：拍照 → 入库）

**验收标准就一条**：手机上拍一张名片，30 秒内出现在看板里，字段可改。

### 6.1 采集端

**先做 iOS 快捷指令，不先做 PWA。** 理由：iOS 快捷指令自带「拍摄照片 → 从图像中提取文本」动作（走系统 Vision，离线、免费、不出网），再把文本 POST 过来即可。零前端工作量，当天能验证整条链路。Android 先用「Google Lens 复制文本 → 系统分享」兜底。

PWA 放第二步：`<input type="file" accept="image/*" capture="environment">` 即可调起相机，不依赖 getUserMedia；但**必须有 HTTPS**（已备案域名已具备）。

### 6.2 上传接口

```
POST /api/capture/text        { text, source, kind }            → captureId
POST /api/capture/image       multipart: file, ocrText?, kind   → captureId
POST /api/capture/vision      { captureId }                     → { visionText }   // 手动触发
GET  /api/capture/:id                                            → capture 详情
```

- `text` 接口是主路径（端上 OCR 已出文本），图片接口是保留原件用。
- 所有接口走同一套鉴权；`text` 上限沿用 `intake` 的 50,000 字。
- 服务端用 `sha256(file)` 去重，重复直接返回已有 captureId。

### 6.3 图片落盘

- 重编码即剥离 EXIF（含 GPS）：用 `sharp` 读入后按 orientation 旋转再输出，**不做原样透传**。
- 路径：`data/objects/<yyyy>/<mm>/<sha256>.enc`，目录权限 700。
- 加密：每文件随机 DEK，AES-256-GCM；DEK 用主密钥包裹后写入文件头（信封加密），主密钥在 `data/secrets/master.key`（600）。
- 类型白名单：`image/jpeg`、`image/png`、`image/heic`（转 jpg）、`application/pdf`。**按文件头魔数判断，不信 `Content-Type`。**

### 6.4 云端视觉（手动，逐次确认）

- 前端每个 capture 卡片上给一个「用云端识别」按钮，点击才发；不做自动。
- 每次触发前弹一次确认：「该图片将上传至第三方模型服务，是否继续？」并记录审计行（时间、captureId、模型名、耗时、返回字数）。
- **前置阻塞：需先验证智谱 Coding Plan 端点是否支持视觉输入。** 现在 `agent/model.ts` 只配了 chat model。若不支持，方案 B 是另配一个视觉模型的 key（走按量计费端点），这属于 P1 范围的额外配置。

### 6.5 抽取与落库

- capture 落库后，入 `agent_tasks` 队列（复用现有 `FOR UPDATE SKIP LOCKED` 机制，无需新建队列）。
- 抽取 agent 沿用三条铁律：不覆盖人工值、被否决不重复、无一手证据不成事实。
- 识别置信度低或有歧义的字段，走现有 `field-decision` 的 accept/reject 范式，不直接写死。

### 6.6 P1 明确不做

- 不做连续拍照批量导入（P2）。
- 不做图册多页、不做 PDF 拆页（P2）。
- 不做语音（P2）。

---

## 七、P2 / P3

### P2：图册、PDF、语音

- **图册**：多页图片归到同一 capture 组，云端视觉逐页手动触发；抽取目标从「名片字段」换成「产品/报价/公司介绍」，落到 `companies` 与自定义字段。
- **PDF**：上传后本地抽文本（VPS 上装 poppler 或 pdfplumber 等价物），抽不出再走视觉。
- **语音**：先走手机自带听写（iOS 键盘听写 / Android 语音输入）→ 复制 → 分享到采集接口。**不要试图在手机上复用 Saydra**，它是 Electron 桌面端，且没有移动端形态。真正的语音转写（录音上传）放最后。
- 采集侧统一：手机端只负责「产出文本 + 可选原图」，所有识别能力的差异都在服务端收敛。

### P3：读取侧 + 联网调研 + 审核门

**读取侧**（满足「读取不是重点，agent 能读就行」）：

- 新增**只读** MCP，工具面只暴露查询：联系人检索、公司检索、事实列表、最近活动。
- 全部查询强制 `research_facts.status='approved'` 过滤。
- 固定面板用现有 `dashboard.ts` / `board.ts` 加一个移动端摘要页即可，不另建可视化系统。

**联网调研**（新模块，crm-mini 明确排除过，需单独立项）：

- 触发：用户在联系人详情点「联网调研」，入独立任务类型。
- 产出**只写 `research_facts`**，一律 `pending`；**绝不直接写 `contacts` / `facts`**。
- 审核界面按 subject 分组，逐条 accept / reject，必须看到 `evidence_url` 原文摘录才能点 accept。
- 未审核的 pending 条目：agent 检索不可见；人工页面可见（标注「未审核」水印）。

---

## 八、安全与「等保」的实话

**个人拿不到等保证书。** 等保测评要求企业主体、系统备案、第三方测评机构现场测评，个人开发者无法满足。任何「我们过了等保」的说法都不成立。

**能做的是对齐等保二级技术基线，并留存自评证据。** 这部分对真实风险也确实有效：

| 控制项 | 做法 | 留什么证据 |
| --- | --- | --- |
| 身份鉴别 | 设备 token + 主密码 + TOTP，长度与失败锁定 | 登录失败日志、token 签发/吊销记录 |
| 访问控制 | 中间件统一鉴权，默认拒绝，最小权限（只读 MCP 独立凭证） | `server/middleware/auth.ts` + 设备清单 |
| 安全审计 | 登录、上传、云端视觉、调研审核四类事件写审计表 | `audit_log` 表，保留 ≥6 个月 |
| 通信保密 | TLS 1.2+，HSTS，禁弱套件 | Nginx 配置 + SSL Labs 报告 |
| 存储保密 | 聊天原文/电话列级加密；原图信封加密；密钥与数据分离 | 密钥文件权限截图、加密字段清单 |
| 数据备份 | 每日 `mysqldump` + `age` 加密 + 异地一份；**每季度演练恢复** | 恢复演练记录（日期、耗时、校验行数） |
| 入侵防范 | 最小端口（只开 443/22）、fail2ban、依赖月度更新 | 端口清单、更新记录 |
| 个人信息保护 | 采集最小化、EXIF 剥离、可导出可删除 | 采集字段清单 |

**真实风险排序（按发生概率，不按理论严重性）：**

1. 27 个裸接口被扫到 → P0 解决；
2. `.env` 明文密钥、备份明文 → 第五节 + 第九节解决；
3. 依赖长期不更新（Nuxt / Drizzle / mysql2 的已知漏洞）→ 月度更新；
4. 误在生产库跑测试 → 5.4 强制拦截；
5. 云端视觉把整张图册送出去 → 逐次确认 + 审计。

---

## 九、密钥与备份

| 资产 | 存放 | 要求 |
| --- | --- | --- |
| `master.key`（加密主密钥） | `data/secrets/master.key` | 600，**不进 git，不进备份包** |
| `totp.key` | `data/secrets/totp.key` | 600 |
| `DATABASE_URL` / `ZAI_API_KEY` / `CRM_TOKEN` | 生产 `.env`（600） | 与代码分离；`.env.example` 只留占位 |
| 密钥备份 | 离线密码管理器 / 打印后锁存 | 丢失 `master.key` = 原图永久不可解，必须单独备份 |

**备份改造（`scripts/backup.sh` 现状不够）：**

1. `mysqldump` 已有参数保留，追加 `--default-character-set=utf8mb4`；
2. 管道接 `age -r <公钥>` 加密后再落盘（**不再产生明文 `.sql.gz`**）；
3. 每日 03:00 定时；本地留 14 天，异地留 30 天；
4. `data/objects` 单独 `restic` 增量备份（自带加密）；
5. 恢复演练：每季度一次，恢复到临时库，核对 `contacts` / `facts` / `captures` 行数。

---

## 十、分期与验收

| 阶段 | 内容 | 验收（全部可执行） |
| --- | --- | --- |
| **P0** | 鉴权 + 设备 token + TOTP + 限流 + 安全头 + `mcp-crm` 凭证 + 测试库隔离 | 5.5 五条 |
| **P1** | 443 上线 + `capture/text` + `capture/image` + 加密落盘 + 名片抽取 + iOS 快捷指令 | 拍名片 → 30 秒内看板可见，字段可改 |
| **P2** | 图册 / PDF / 语音听写 / 手动云端视觉 | 一本 10 页图册能整册入到同一公司下 |
| **P3** | 只读 MCP + 移动摘要页 + 联网调研 + 审核门 | 未审核调研条目在 agent 回答中**一次都不出现** |

**每阶段结束必须做的事**：跑一次恢复演练、检查一次端口暴露面、更新一次依赖。不攒到最后。

---

## 十一、前置验证清单（动手前先确认）

1. **智谱 Coding Plan 端点是否支持图像输入** —— 决定 P2 的云端视觉走哪条路。
2. **VPS 规格** —— 需要 4 GB 内存起步（Nuxt + MySQL + 抽取任务）；磁盘按「原图 5 MB × 每日 50 张 × 1 年 ≈ 90 GB」估。
3. **域名解析与证书自动化** —— 已备案，直接上 Certbot；确认 80 端口可用（HTTP-01 验证）。
4. **双中心主数据源** —— 云 CRM 与本地天枢，同一客户的数据以谁为准，必须先定，否则后期同步会打架。

---

## 十二、明确不做

- 不做多用户 / 组织 / 角色（README 已定，保持不变）。
- 不做端到端加密（会让 agent 抽取能力失效）。
- 不做微信小程序（需重写 UI 与流式链路，收益低于 PWA）。
- 不做 `contacts` 姓名/电话的可搜索加密（要引入盲索引，复杂度高、收益低）。
- 不把联网调研结论直接写入 `facts` / `contacts`（只进 `research_facts`，必须人工审核）。
- 不在 VPS 上跑 `bun test`（TRUNCATE 风险）。

---

## 十三、对生态的实际贡献

| 能力 | 可复用 | 说明 |
| --- | --- | --- |
| 单用户鉴权 / 设备 token / 审计 | ✅ | 后续任何自建服务直接抄这套中间件 |
| 加密存储 / 密钥分离 / 恢复演练 | ✅ | 天枢的备份也缺这一环，可反向借鉴 |
| 手机采集入口 | ✅ | 未来「随手记」类产品的通用入口 |
| 客户数据 | ⚠️ | 只服务 P3 外贸助手，不进天枢记忆图 |
| 天枢 / 玉衡 | ❌ | 本地运行，本方案不触碰 |
| 意图编排 / 判断基准 | ❌ | 需要分支与改写数据，CRM 不产生这类信号 |

**一句话**：这条路给生态准备的是「地基与门」，不是「记忆与判断」。地基值得先打，但别指望它替你推进 P0 的玉衡。
