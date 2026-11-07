import en from "../../locales/en/settings.organizationSlugField.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.organizationSlugField", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.organizationSlugField.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.organizationSlugField.json"),
})
