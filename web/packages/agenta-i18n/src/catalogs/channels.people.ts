import {defineCatalog} from "../catalog"

export default defineCatalog("channels.people", {
    en: () => import("../../locales/en/channels.people.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.people.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.people.json"),
})
