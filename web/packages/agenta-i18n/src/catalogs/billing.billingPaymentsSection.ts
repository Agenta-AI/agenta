import {defineCatalog} from "../catalog"

export default defineCatalog("billing.billingPaymentsSection", {
    en: () => import("../../locales/en/billing.billingPaymentsSection.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.billingPaymentsSection.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.billingPaymentsSection.json"),
})
