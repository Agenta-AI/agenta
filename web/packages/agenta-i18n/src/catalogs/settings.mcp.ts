import en from "../../locales/en/settings.mcp.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.mcp", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.mcp.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.mcp.json"),
})
