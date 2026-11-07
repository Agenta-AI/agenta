import en from "../../locales/en/billing.planOptionCard.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.planOptionCard", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.planOptionCard.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.planOptionCard.json"),
})
