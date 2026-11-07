import en from "../../locales/en/settings.ssoProviderDialog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.ssoProviderDialog", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.ssoProviderDialog.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.ssoProviderDialog.json"),
})
