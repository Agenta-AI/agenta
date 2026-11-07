import {defineCatalog} from "../catalog"

export default defineCatalog("settings.channelsTab", {
    en: () => import("../../locales/en/settings.channelsTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.channelsTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.channelsTab.json"),
})
