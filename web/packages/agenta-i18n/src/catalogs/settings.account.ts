import en from "../../locales/en/settings.account.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.account", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.account.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.account.json"),
})
