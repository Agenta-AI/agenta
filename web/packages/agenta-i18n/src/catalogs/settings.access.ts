import {defineCatalog} from "../catalog"

export default defineCatalog("settings.access", {
    en: () => import("../../locales/en/settings.access.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.access.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.access.json"),
})
