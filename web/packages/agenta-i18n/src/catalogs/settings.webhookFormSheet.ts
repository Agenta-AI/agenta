import en from "../../locales/en/settings.webhookFormSheet.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.webhookFormSheet", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.webhookFormSheet.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.webhookFormSheet.json"),
})
