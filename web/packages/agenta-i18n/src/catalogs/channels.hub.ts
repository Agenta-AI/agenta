import en from "../../locales/en/channels.hub.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.hub", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.hub.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.hub.json"),
})
