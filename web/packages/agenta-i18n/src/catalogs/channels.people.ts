import en from "../../locales/en/channels.people.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.people", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.people.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.people.json"),
})
