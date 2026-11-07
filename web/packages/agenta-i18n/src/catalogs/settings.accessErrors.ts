import {defineCatalog} from "../catalog"

export default defineCatalog("settings.accessErrors", {
    en: () => import("../../locales/en/settings.accessErrors.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.accessErrors.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.accessErrors.json"),
})
