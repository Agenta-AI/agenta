import en from "../../locales/en/publish.json"
import {defineCatalog} from "../catalog"

export default defineCatalog("publish", en, {
    "zh-CN": () => import("../../locales/zh-CN/publish.json"),
    "ja-JP": () => import("../../locales/ja-JP/publish.json"),
})
