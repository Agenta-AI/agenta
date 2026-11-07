import {defineCatalog} from "../catalog"

export default defineCatalog("channels.page", {
    en: () => import("../../locales/en/channels.page.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.page.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.page.json"),
})
