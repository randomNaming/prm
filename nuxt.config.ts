import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
	srcDir: "app",
	serverDir: "server",

	modules: ["@element-plus/nuxt"],

	elementPlus: {
		defaultLocale: "zh-cn",
	},

	css: ["~/assets/css/main.css", "~/assets/css/contact.css", "~/assets/css/list.css"],

	devtools: { enabled: false },

	// 构建时遥测模块要往用户家目录写 .nuxtrc，家里这台机器会被系统拦（EPERM），干脆关掉。
	telemetry: false,

	compatibilityDate: "2026-10-12",

	app: {
		head: {
			htmlAttrs: { lang: "zh-CN" },
			title: "极简 CRM",
			meta: [
				{ charset: "utf-8" },
				{ name: "viewport", content: "width=device-width, initial-scale=1" },
			],
		},
	},

	nitro: {
		experimental: {
			websocket: false,
		},

		// 迁移 SQL 跟着 .output 一起走：生产服务器不需要仓库、也不需要 SSH 拷文件。
		// 运行时由 server/utils/auto-migrate.ts 通过 useStorage("assets:migrations") 读取。
		serverAssets: [
			{
				baseName: "migrations",
				dir: fileURLToPath(new URL("./server/db/migrations", import.meta.url)),
			},
		],
	},

	typescript: {
		strict: true,
	},
});
