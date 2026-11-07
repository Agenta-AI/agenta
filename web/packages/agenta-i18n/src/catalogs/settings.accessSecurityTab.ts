import {defineCatalog} from "../catalog"

export default defineCatalog("settings.accessSecurityTab", {
    en: () => import("../../locales/en/settings.accessSecurityTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.accessSecurityTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.accessSecurityTab.json"),
})
