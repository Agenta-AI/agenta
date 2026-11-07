import {defineCatalog} from "../catalog"

export default defineCatalog("channels.advanced", {
    en: () => import("../../locales/en/channels.advanced.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.advanced.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.advanced.json"),
})
