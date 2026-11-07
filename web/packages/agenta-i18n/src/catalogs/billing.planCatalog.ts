import en from "../../locales/en/billing.planCatalog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.planCatalog", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.planCatalog.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.planCatalog.json"),
})
