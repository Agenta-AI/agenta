import {defineCatalog} from "../catalog"

export default defineCatalog("settings.apiKeysTab", {
    en: () => import("../../locales/en/settings.apiKeysTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.apiKeysTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.apiKeysTab.json"),
})
