import en from "../../locales/en/settings.accessSecurityTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.accessSecurityTab", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.accessSecurityTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.accessSecurityTab.json"),
})
