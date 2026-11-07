import en from "../../locales/en/billing.planSummaryCard.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.planSummaryCard", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.planSummaryCard.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.planSummaryCard.json"),
})
