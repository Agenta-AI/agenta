import en from "../../locales/en/channels.labels.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.labels", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.labels.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.labels.json"),
})
