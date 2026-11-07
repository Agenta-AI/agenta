import {defineCatalog} from "../catalog"

export default defineCatalog("settings.organizationsTab", {
    en: () => import("../../locales/en/settings.organizationsTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.organizationsTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.organizationsTab.json"),
})
