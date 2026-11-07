import en from "../../locales/en/channels.agentPicker.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("channels.agentPicker", en, {
    "zh-CN": () => import("../../locales/zh-CN/channels.agentPicker.json"),
    "ja-JP": () => import("../../locales/ja-JP/channels.agentPicker.json"),
})
