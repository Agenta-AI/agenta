import en from "../../locales/en/billing.billingFormat.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.billingFormat", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.billingFormat.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.billingFormat.json"),
})
