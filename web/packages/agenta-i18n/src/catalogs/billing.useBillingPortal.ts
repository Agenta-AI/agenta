import {defineCatalog} from "../catalog"

export default defineCatalog("billing.useBillingPortal", {
    en: () => import("../../locales/en/billing.useBillingPortal.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.useBillingPortal.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.useBillingPortal.json"),
})
