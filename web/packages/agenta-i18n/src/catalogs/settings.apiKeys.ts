import en from "../../locales/en/settings.apiKeys.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.apiKeys", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.apiKeys.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.apiKeys.json"),
})
