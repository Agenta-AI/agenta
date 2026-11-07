import en from "../../locales/en/billing.topups.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.topups", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.topups.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.topups.json"),
})
