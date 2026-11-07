import en from "../../locales/en/settings.addDomainDialog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.addDomainDialog", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.addDomainDialog.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.addDomainDialog.json"),
})
