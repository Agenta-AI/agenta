import {defineCatalog} from "../catalog"

export default defineCatalog("billing.planCreditsCard", {
    en: () => import("../../locales/en/billing.planCreditsCard.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.planCreditsCard.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.planCreditsCard.json"),
})
