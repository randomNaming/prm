export default defineNuxtConfig({
	srcDir: "app",
	serverDir: "server",

	modules: ["@element-plus/nuxt"],

	elementPlus: {
		defaultLocale: "zh-cn",
	},

	css: ["~/assets/css/main.css"],

	devtools: { enabled: false },

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
	},

	typescript: {
		strict: true,
	},
});
