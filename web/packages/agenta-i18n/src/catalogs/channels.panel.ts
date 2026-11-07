import en from "../../locales/en/channels.panel.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.panel", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.panel.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.panel.json"),
})
