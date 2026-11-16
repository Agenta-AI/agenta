import en from "../../locales/en/chat.attachmentStrip.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.attachmentStrip",
    en,
    (language) => import(`../../locales/${language}/chat.attachmentStrip.json`),
)
