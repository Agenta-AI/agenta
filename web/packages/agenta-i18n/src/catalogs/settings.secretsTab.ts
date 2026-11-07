import {defineCatalog} from "../catalog"

export default defineCatalog("settings.secretsTab", {
    en: () => import("../../locales/en/settings.secretsTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.secretsTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.secretsTab.json"),
})
