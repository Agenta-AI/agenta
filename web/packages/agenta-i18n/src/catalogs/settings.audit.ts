import {defineCatalog} from "../catalog"

export default defineCatalog("settings.audit", {
    en: () => import("../../locales/en/settings.audit.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.audit.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.audit.json"),
})
