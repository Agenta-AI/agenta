import {defineCatalog} from "../catalog"

export default defineCatalog("settings.webhookFormSheet", {
    en: () => import("../../locales/en/settings.webhookFormSheet.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.webhookFormSheet.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.webhookFormSheet.json"),
})
