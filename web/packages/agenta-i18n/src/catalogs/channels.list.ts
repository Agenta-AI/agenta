import {defineCatalog} from "../catalog"

export default defineCatalog("channels.list", {
    en: () => import("../../locales/en/channels.list.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.list.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.list.json"),
})
