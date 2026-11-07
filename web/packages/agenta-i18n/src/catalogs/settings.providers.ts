import {defineCatalog} from "../catalog"

export default defineCatalog("settings.providers", {
    en: () => import("../../locales/en/settings.providers.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.providers.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.providers.json"),
})
