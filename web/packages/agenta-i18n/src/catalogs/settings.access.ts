import en from "../../locales/en/settings.access.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.access", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.access.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.access.json"),
})
