import en from "../../locales/en/settings.invitedLinkDialog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.invitedLinkDialog", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.invitedLinkDialog.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.invitedLinkDialog.json"),
})
