import {defineCatalog} from "../catalog"

export default defineCatalog("settings.preferences", {
    en: () => import("../../locales/en/settings.preferences.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.preferences.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.preferences.json"),
})
