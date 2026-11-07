import {defineCatalog} from "../catalog"

export default defineCatalog("billing.billingFormat", {
    en: () => import("../../locales/en/billing.billingFormat.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.billingFormat.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.billingFormat.json"),
})
