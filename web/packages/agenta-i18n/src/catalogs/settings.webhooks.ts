import en from "../../locales/en/settings.webhooks.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.webhooks", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.webhooks.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.webhooks.json"),
})
