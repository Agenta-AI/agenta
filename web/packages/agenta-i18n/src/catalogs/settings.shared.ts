import en from "../../locales/en/settings.shared.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.shared", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.shared.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.shared.json"),
})
