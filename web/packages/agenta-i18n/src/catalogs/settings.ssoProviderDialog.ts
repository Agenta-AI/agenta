import {defineCatalog} from "../catalog"

export default defineCatalog("settings.ssoProviderDialog", {
    en: () => import("../../locales/en/settings.ssoProviderDialog.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.ssoProviderDialog.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.ssoProviderDialog.json"),
})
