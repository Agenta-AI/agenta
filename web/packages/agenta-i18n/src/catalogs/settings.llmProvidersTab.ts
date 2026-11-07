import en from "../../locales/en/settings.llmProvidersTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.llmProvidersTab", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.llmProvidersTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.llmProvidersTab.json"),
})
