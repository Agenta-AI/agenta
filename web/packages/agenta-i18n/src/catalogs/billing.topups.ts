import {defineCatalog} from "../catalog"

export default defineCatalog("billing.topups", {
    en: () => import("../../locales/en/billing.topups.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.topups.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.topups.json"),
})
