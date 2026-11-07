import en from "../../locales/en/settings.secretsTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.secretsTab", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.secretsTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.secretsTab.json"),
})
