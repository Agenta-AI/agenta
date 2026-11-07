import en from "../../locales/en/settings.tools.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.tools", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.tools.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.tools.json"),
})
