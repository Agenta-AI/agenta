import {defineCatalog} from "../catalog"

export default defineCatalog("settings.organizationSlugField", {
    en: () => import("../../locales/en/settings.organizationSlugField.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.organizationSlugField.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.organizationSlugField.json"),
})
