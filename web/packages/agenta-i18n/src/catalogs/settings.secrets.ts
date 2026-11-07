import {defineCatalog} from "../catalog"

export default defineCatalog("settings.secrets", {
    en: () => import("../../locales/en/settings.secrets.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.secrets.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.secrets.json"),
})
