import {defineCatalog} from "../catalog"

export default defineCatalog("channels.status", {
    en: () => import("../../locales/en/channels.status.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.status.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.status.json"),
})
