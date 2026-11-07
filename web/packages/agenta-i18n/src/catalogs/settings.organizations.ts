import {defineCatalog} from "../catalog"

export default defineCatalog("settings.organizations", {
    en: () => import("../../locales/en/settings.organizations.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.organizations.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.organizations.json"),
})
