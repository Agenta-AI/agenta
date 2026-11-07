import en from "../../locales/en/billing.planLimits.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.planLimits", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.planLimits.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.planLimits.json"),
})
