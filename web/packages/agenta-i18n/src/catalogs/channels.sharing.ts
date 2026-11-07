import {defineCatalog} from "../catalog"

export default defineCatalog("channels.sharing", {
    en: () => import("../../locales/en/channels.sharing.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.sharing.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.sharing.json"),
})
