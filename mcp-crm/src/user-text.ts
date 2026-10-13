export const TEXT = {
  unknownError: "未知错误",
  missingBaseUrl: (envFilePath: string): string =>
    [
      "错误：未配置必需的环境变量 CRM_BASE_URL。",
      "原因：该变量指向 CRM 平台的地址，本服务把聊天记录原文转发到它的 /api/intake 端点。",
      `修复：在 ${envFilePath} 中写入 CRM_BASE_URL=http://127.0.0.1:3100，或直接设置同名环境变量后重试。`,
    ].join("\n"),
  invalidBaseUrl: (rawValue: string): string =>
    [
      `错误：CRM_BASE_URL 不是合法的 http/https 地址：${rawValue}`,
      "修复：写成协议 + 主机 + 端口的形式，例如 http://127.0.0.1:3100。",
    ].join("\n"),
  invalidMaxTextLength: (rawValue: string): string =>
    [
      `错误：CRM_MAX_TEXT_LENGTH 的值无效（${rawValue}）。`,
      "原因：必须是大于 0 的整数。",
      "修复：删除该变量使用默认值 50000，或填写一个正整数。",
    ].join("\n"),
  invalidHttpPort: (rawValue: string): string =>
    [
      `警告：MCP_HTTP_PORT 的值无效（${rawValue}），已忽略该变量。`,
      "说明：端口必须是 1 到 65535 之间的整数。本次改为仅使用 stdio 模式。",
    ].join("\n"),
  stdioMode: "说明：以 stdio 模式启动，等待 MCP 客户端通过标准输入输出连接。",
  httpMode: (host: string, port: number, path: string): string =>
    [
      `说明：已启用 Streamable HTTP 模式，监听 http://${host}:${port}${path}，未启动 stdio。`,
      "安全：该端口默认只绑定本机回环地址。若要对公网暴露，必须前置反向代理并配置认证。",
    ].join("\n"),
  ready: (baseUrl: string): string =>
    `说明：已就绪，聊天记录将转发到 ${baseUrl}/api/intake。本服务不解析、不改写记录内容。`,
  fatalStartup: (detail: string): string => `错误：服务启动失败。原因：${detail}`,
  httpNotFound: "404：该路径不提供服务。Streamable HTTP 端点见 README 的 MCP_HTTP_PORT 说明。",
  httpMethodNotAllowed: "405：该端点只接受 POST 请求。",

  toolImportChat:
    "把一段聊天记录原样转发给 CRM 平台，由平台侧智能体抽取联系人与公司并写入 CRM。本工具不做任何解析或加工：你给什么就转什么。返回平台的处理结果，包含平台是否可用、新建了哪些联系人/公司、各工具的调用次数。",
  toolIntakeStatus: "查看 CRM 平台智能体是否可用。写入失败前先问一句，可区分「平台没起」与「平台不认这条记录」。",

  personArgument:
    "会话对方的昵称，用于在平台上标识这段记录属于谁。取值建议与来源系统（如微信导出）中的会话名一致。",
  fileArgument: "可选的来源文件名，会被平台写进证据出处，方便日后回溯是哪份记录。",
  textArgument:
    "聊天记录原文，逐字传入，不要预先改写、翻译或总结。超长记录请分批多次调用，每批之间保持时间顺序。",
  batchHint: (max: number): string =>
    `注意：单次转发的记录原文上限为 ${max} 字符，超限请拆成多批、按时间先后依次调用。`,
} as const;
