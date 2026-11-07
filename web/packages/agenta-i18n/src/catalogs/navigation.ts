import en from "../../locales/en/navigation.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("navigation", en, {
    "zh-CN": () => import("../../locales/zh-CN/navigation.json"),
    "ja-JP": () => import("../../locales/ja-JP/navigation.json"),
})
