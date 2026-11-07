import en from "../../locales/en/common.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("common", en, {
    "zh-CN": () => import("../../locales/zh-CN/common.json"),
    "ja-JP": () => import("../../locales/ja-JP/common.json"),
})
