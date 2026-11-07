import en from "../../locales/en/settings.organizationsTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.organizationsTab", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.organizationsTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.organizationsTab.json"),
})
