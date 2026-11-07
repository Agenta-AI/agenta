import en from "../../locales/en/settings.providers.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.providers", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.providers.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.providers.json"),
})
