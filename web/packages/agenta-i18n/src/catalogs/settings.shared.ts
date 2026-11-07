import {defineCatalog} from "../catalog"

export default defineCatalog("settings.shared", {
    en: () => import("../../locales/en/settings.shared.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.shared.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.shared.json"),
})
