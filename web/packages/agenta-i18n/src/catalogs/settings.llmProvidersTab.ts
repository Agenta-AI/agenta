import {defineCatalog} from "../catalog"

export default defineCatalog("settings.llmProvidersTab", {
    en: () => import("../../locales/en/settings.llmProvidersTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.llmProvidersTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.llmProvidersTab.json"),
})
