import en from "../../locales/en/billing.page.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.page", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.page.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.page.json"),
})
