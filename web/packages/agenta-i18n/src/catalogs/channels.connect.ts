import {defineCatalog} from "../catalog"

export default defineCatalog("channels.connect", {
    en: () => import("../../locales/en/channels.connect.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.connect.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.connect.json"),
})
