import {defineCatalog} from "../catalog"

export default defineCatalog("channels.hub", {
    en: () => import("../../locales/en/channels.hub.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.hub.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.hub.json"),
})
