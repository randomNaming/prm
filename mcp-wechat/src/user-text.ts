export const TEXT = {
  unknownError: "未知错误",
  missingExportDir: (envFilePath: string): string =>
    [
      "错误：未配置必需的环境变量 WECHAT_EXPORT_DIR。",
      "原因：该变量指向微信聊天记录导出文件所在的目录，本服务只读该目录。",
      `修复：在 ${envFilePath} 中写入 WECHAT_EXPORT_DIR=<目录绝对路径>，或直接设置同名环境变量后重试。`,
    ].join("\n"),
  exportDirMissing: (exportDir: string, code: string): string =>
    [
      `错误：WECHAT_EXPORT_DIR 指向的目录不存在或无法访问：${exportDir}`,
      `原因：${code}`,
      "修复：确认路径拼写、盘符与目录存在，并确认当前用户有读取权限。",
    ].join("\n"),
  exportDirNotDirectory: (exportDir: string): string =>
    [
      `错误：WECHAT_EXPORT_DIR 指向的不是目录：${exportDir}`,
      "修复：把它改成存放微信导出 txt 文件的目录路径。",
    ].join("\n"),
  exportDirUnreadable: (exportDir: string, code: string): string =>
    [
      `错误：WECHAT_EXPORT_DIR 指向的目录无法读取：${exportDir}`,
      `原因：${code}`,
      "修复：确认当前用户对该目录有读取与列目录权限。",
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
  indexReady: (chatCount: number, skippedLines: number): string =>
    `说明：索引已建立，共 ${chatCount} 个会话，跳过 ${skippedLines} 行无法解析的文本。`,
  fileTooLarge: (fileName: string, maxBytes: number): string =>
    `警告：文件 ${fileName} 超过单文件上限 ${maxBytes} 字节，已跳过该文件。`,
  fileUnreadable: (fileName: string, code: string): string =>
    `警告：文件 ${fileName} 无法读取（${code}），已跳过该文件。`,
  fatalStartup: (detail: string): string =>
    `错误：服务启动失败。原因：${detail}`,
  httpNotFound: "404：该路径不提供服务。Streamable HTTP 端点见 README 的 MCP_HTTP_PORT 说明。",
  httpMethodNotAllowed: "405：该端点只接受 POST 请求。",
  toolListChats:
    "列出导出目录中所有可识别的会话。返回纯数据 JSON 数组，每项包含昵称、来源文件名、消息条数与时间范围。不做任何推断或总结。",
  toolSearchMessages:
    "按昵称检索某个会话的消息原文。可选 keyword 为纯子串匹配（比较前统一转小写），不支持拼音、模糊匹配或同义词。昵称不存在时返回空数组并给出可用昵称列表，不报错。",
  toolGetRecent:
    "返回某个会话最近的 limit 条消息原文，按时间升序排列。昵称不存在时返回空数组并给出可用昵称列表，不报错。",
  personArgument: "会话对方的昵称，取自导出文件名或该会话中唯一的非本人发送者，须与 list_chats 返回的 person 完全一致。",
  keywordArgument: "可选的纯子串关键词；省略或留空表示不过滤。",
  limitArgument: "返回的消息条数上限，省略时使用默认值。",
} as const;
