import en from "../../locales/en/billing.planChooserSheet.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("billing.planChooserSheet", en, {
    "zh-CN": () => import("../../locales/zh-CN/billing.planChooserSheet.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.planChooserSheet.json"),
})
