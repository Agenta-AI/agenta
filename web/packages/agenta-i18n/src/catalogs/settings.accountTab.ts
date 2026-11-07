import {defineCatalog} from "../catalog"

export default defineCatalog("settings.accountTab", {
    en: () => import("../../locales/en/settings.accountTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.accountTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.accountTab.json"),
})
