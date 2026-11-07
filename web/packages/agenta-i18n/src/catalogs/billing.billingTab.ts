import {defineCatalog} from "../catalog"

export default defineCatalog("billing.billingTab", {
    en: () => import("../../locales/en/billing.billingTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.billingTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.billingTab.json"),
})
