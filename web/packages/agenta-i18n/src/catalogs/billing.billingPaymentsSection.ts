import en from "../../locales/en/billing.billingPaymentsSection.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.billingPaymentsSection", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.billingPaymentsSection.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.billingPaymentsSection.json"),
})
