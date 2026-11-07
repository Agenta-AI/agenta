import {defineCatalog} from "../catalog"

export default defineCatalog("channels.agentPicker", {
    en: () => import("../../locales/en/channels.agentPicker.json"),
    "zh-CN": () => import("../../locales/zh-CN/channels.agentPicker.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.agentPicker.json"),
})
