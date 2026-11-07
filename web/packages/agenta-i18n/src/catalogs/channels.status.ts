import en from "../../locales/en/channels.status.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.status", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.status.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.status.json"),
})
