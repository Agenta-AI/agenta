import {defineCatalog} from "../catalog"

export default defineCatalog("settings.domainDnsInstructions", {
    en: () => import("../../locales/en/settings.domainDnsInstructions.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.domainDnsInstructions.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.domainDnsInstructions.json"),
})
