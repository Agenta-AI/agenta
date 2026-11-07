import en from "../../locales/en/billing.planCreditsCard.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.planCreditsCard", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.planCreditsCard.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.planCreditsCard.json"),
})
