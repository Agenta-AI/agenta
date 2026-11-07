import {defineCatalog} from "../catalog"

export default defineCatalog("settings.states", {
    en: () => import("../../locales/en/settings.states.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.states.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.states.json"),
})
