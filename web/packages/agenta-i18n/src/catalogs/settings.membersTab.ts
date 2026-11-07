import {defineCatalog} from "../catalog"

export default defineCatalog("settings.membersTab", {
    en: () => import("../../locales/en/settings.membersTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.membersTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.membersTab.json"),
})
