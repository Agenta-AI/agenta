import en from "../../locales/en/settings.projectsTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.projectsTab", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.projectsTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.projectsTab.json"),
})
