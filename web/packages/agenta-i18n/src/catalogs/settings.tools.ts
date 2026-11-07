import {defineCatalog} from "../catalog"

export default defineCatalog("settings.tools", {
    en: () => import("../../locales/en/settings.tools.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.tools.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.tools.json"),
})
