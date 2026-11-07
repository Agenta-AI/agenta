import en from "../../locales/en/settingsTabs.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settingsTabs", en, {
    "zh-CN": () => import("../../locales/zh-CN/settingsTabs.json"),
    "ja-JP": () => import("../../locales/ja-JP/settingsTabs.json"),
})
