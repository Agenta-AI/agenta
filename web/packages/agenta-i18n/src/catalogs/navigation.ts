import {defineCatalog} from "../catalog"

export default defineCatalog("navigation", {
    en: () => import("../../locales/en/navigation.json"),
    "zh-CN": () => import("../../locales/zh-CN/navigation.json"),
    "ja-JP": () => import("../../locales/ja-JP/navigation.json"),
})
