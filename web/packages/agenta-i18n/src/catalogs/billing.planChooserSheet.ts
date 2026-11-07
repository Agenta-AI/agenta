import {defineCatalog} from "../catalog"

export default defineCatalog("billing.planChooserSheet", {
    en: () => import("../../locales/en/billing.planChooserSheet.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.planChooserSheet.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.planChooserSheet.json"),
})
