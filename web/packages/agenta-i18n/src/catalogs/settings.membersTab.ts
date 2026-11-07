import en from "../../locales/en/settings.membersTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.membersTab", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.membersTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.membersTab.json"),
})
