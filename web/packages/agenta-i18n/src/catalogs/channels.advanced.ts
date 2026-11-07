import en from "../../locales/en/channels.advanced.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.advanced", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.advanced.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.advanced.json"),
})
