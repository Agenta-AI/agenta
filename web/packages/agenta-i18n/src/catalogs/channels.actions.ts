import {defineCatalog} from "../catalog"

export default defineCatalog("channels.actions", {
    en: () => import("../../locales/en/channels.actions.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.actions.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.actions.json"),
})
