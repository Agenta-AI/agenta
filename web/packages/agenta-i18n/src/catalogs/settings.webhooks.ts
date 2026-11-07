import {defineCatalog} from "../catalog"

export default defineCatalog("settings.webhooks", {
    en: () => import("../../locales/en/settings.webhooks.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.webhooks.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.webhooks.json"),
})
