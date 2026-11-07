import en from "../../locales/en/settings.resetPasswordLinkDialog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("settings.resetPasswordLinkDialog", en, {
    "zh-CN": () => import("../../locales/zh-CN/settings.resetPasswordLinkDialog.json"),
    "ja-JP": () => import("../../locales/ja-JP/settings.resetPasswordLinkDialog.json"),
})
