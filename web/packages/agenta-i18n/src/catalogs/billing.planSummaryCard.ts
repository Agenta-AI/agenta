import {defineCatalog} from "../catalog"

export default defineCatalog("billing.planSummaryCard", {
    en: () => import("../../locales/en/billing.planSummaryCard.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.planSummaryCard.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.planSummaryCard.json"),
})
