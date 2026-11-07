import {defineCatalog} from "../catalog"

export default defineCatalog("billing.cancelSubscriptionSheet", {
    en: () => import("../../locales/en/billing.cancelSubscriptionSheet.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.cancelSubscriptionSheet.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.cancelSubscriptionSheet.json"),
})
