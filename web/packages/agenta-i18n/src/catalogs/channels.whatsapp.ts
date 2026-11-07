import en from "../../locales/en/channels.whatsapp.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.whatsapp", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.whatsapp.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.whatsapp.json"),
})
