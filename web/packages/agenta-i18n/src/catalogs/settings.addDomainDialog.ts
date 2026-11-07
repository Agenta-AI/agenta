import {defineCatalog} from "../catalog"

export default defineCatalog("settings.addDomainDialog", {
    en: () => import("../../locales/en/settings.addDomainDialog.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.addDomainDialog.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.addDomainDialog.json"),
})
