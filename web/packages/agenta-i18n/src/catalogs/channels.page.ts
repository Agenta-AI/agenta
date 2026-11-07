import en from "../../locales/en/channels.page.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.page", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.page.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.page.json"),
})
