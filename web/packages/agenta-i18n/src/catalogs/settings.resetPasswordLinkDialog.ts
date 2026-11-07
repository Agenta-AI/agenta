import {defineCatalog} from "../catalog"

export default defineCatalog("settings.resetPasswordLinkDialog", {
    en: () => import("../../locales/en/settings.resetPasswordLinkDialog.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.resetPasswordLinkDialog.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.resetPasswordLinkDialog.json"),
})
