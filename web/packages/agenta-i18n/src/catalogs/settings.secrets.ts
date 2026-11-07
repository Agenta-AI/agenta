import en from "../../locales/en/settings.secrets.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.secrets", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.secrets.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.secrets.json"),
})
