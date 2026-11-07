import {defineCatalog} from "../catalog"

export default defineCatalog("settings.members", {
    en: () => import("../../locales/en/settings.members.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.members.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.members.json"),
})
