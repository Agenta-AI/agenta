import en from "../../locales/en/settings.audit.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.audit", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.audit.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.audit.json"),
})
