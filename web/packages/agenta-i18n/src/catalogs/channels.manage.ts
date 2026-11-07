import en from "../../locales/en/channels.manage.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.manage", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.manage.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.manage.json"),
})
