import {defineCatalog} from "../catalog"

export default defineCatalog("settings.projectsTab", {
    en: () => import("../../locales/en/settings.projectsTab.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.projectsTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.projectsTab.json"),
})
