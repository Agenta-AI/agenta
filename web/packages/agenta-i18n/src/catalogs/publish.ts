import {defineCatalog} from "../catalog"

export default defineCatalog("publish", {
    en: () => import("../../locales/en/publish.json"),
    "zh-CN": () => import("../../locales/zh-CN/publish.json"),
    "ja-JP": () => import("../../locales/ja-JP/publish.json"),
})
