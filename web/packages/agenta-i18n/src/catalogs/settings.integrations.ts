import en from "../../locales/en/settings.integrations.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.integrations", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.integrations.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.integrations.json"),
})
