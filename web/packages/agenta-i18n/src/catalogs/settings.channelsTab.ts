import en from "../../locales/en/settings.channelsTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.channelsTab", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.channelsTab.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.channelsTab.json"),
})
