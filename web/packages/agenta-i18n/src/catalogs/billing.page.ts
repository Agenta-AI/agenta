import {defineCatalog} from "../catalog"

export default defineCatalog("billing.page", {
    en: () => import("../../locales/en/billing.page.json"),
    "zh-CN": () => import("../../locales/zh-CN/billing.page.json"),
    "ja-JP": () => import("../../locales/ja-JP/billing.page.json"),
})
