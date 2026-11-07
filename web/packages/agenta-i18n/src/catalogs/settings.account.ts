import {defineCatalog} from "../catalog"

export default defineCatalog("settings.account", {
    en: () => import("../../locales/en/settings.account.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.account.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.account.json"),
})
