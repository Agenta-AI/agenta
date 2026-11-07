import en from "../../locales/en/settings.preferences.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.preferences", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.preferences.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.preferences.json"),
})
