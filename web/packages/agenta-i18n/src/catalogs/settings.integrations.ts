import {defineCatalog} from "../catalog"

export default defineCatalog("settings.integrations", {
    en: () => import("../../locales/en/settings.integrations.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.integrations.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.integrations.json"),
})
