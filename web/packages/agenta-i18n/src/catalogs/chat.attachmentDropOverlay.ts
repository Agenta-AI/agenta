import en from "../../locales/en/chat.attachmentDropOverlay.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.attachmentDropOverlay",
    en,
    (language) => import(`../../locales/${language}/chat.attachmentDropOverlay.json`),
)
