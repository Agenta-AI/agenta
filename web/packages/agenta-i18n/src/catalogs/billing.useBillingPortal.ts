import en from "../../locales/en/billing.useBillingPortal.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.useBillingPortal", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.useBillingPortal.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.useBillingPortal.json"),
})
