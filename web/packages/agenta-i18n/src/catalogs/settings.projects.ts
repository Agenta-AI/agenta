import {defineCatalog} from "../catalog"

export default defineCatalog("settings.projects", {
    en: () => import("../../locales/en/settings.projects.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.projects.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.projects.json"),
})
