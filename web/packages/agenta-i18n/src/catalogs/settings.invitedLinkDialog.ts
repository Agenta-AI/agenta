import {defineCatalog} from "../catalog"

export default defineCatalog("settings.invitedLinkDialog", {
    en: () => import("../../locales/en/settings.invitedLinkDialog.json"),
    "zh-CN": () => import("../../locales/zh-CN/settings.invitedLinkDialog.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.invitedLinkDialog.json"),
})
