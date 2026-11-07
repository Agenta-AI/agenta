import en from "../../locales/en/channels.sharing.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.sharing", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.sharing.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.sharing.json"),
})
