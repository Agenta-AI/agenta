import {defineCatalog} from "../catalog"

export default defineCatalog("common", {
    en: () => import("../../locales/en/common.json"),
    "zh-CN": () => import("../../locales/zh-CN/common.json"),
    "ja-JP": () => import("../../locales/ja-JP/common.json"),
})
