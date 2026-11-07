import {defineCatalog} from "../catalog"

export default defineCatalog("channels.manage", {
    en: () => import("../../locales/en/channels.manage.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.manage.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.manage.json"),
})
