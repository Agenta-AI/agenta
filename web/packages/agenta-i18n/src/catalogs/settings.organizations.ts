import en from "../../locales/en/settings.organizations.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.organizations", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.organizations.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.organizations.json"),
})
