import {defineCatalog} from "../catalog"

export default defineCatalog("settings.apiKeys", {
    en: () => import("../../locales/en/settings.apiKeys.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.apiKeys.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.apiKeys.json"),
})
