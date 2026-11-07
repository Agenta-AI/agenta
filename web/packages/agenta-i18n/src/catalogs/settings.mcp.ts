import {defineCatalog} from "../catalog"

export default defineCatalog("settings.mcp", {
    en: () => import("../../locales/en/settings.mcp.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.mcp.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.mcp.json"),
})
