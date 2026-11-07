import {defineCatalog} from "../catalog"

export default defineCatalog("channels.whatsapp", {
    en: () => import("../../locales/en/channels.whatsapp.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.whatsapp.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.whatsapp.json"),
})
