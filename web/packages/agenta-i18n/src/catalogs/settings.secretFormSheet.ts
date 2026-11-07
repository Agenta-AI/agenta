import {defineCatalog} from "../catalog"

export default defineCatalog("settings.secretFormSheet", {
    en: () => import("../../locales/en/settings.secretFormSheet.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.secretFormSheet.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.secretFormSheet.json"),
})
