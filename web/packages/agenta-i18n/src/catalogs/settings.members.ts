import en from "../../locales/en/settings.members.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.members", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.members.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.members.json"),
})
