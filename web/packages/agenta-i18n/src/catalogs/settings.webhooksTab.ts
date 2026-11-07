import {defineCatalog} from "../catalog"

export default defineCatalog("settings.webhooksTab", {
    en: () => import("../../locales/en/settings.webhooksTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.webhooksTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.webhooksTab.json"),
})
