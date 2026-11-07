import en from "../../locales/en/settings.accountTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.accountTab", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.accountTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.accountTab.json"),
})
