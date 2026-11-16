import en from "../../locales/en/chat.sessionHistoryNotice.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.sessionHistoryNotice",
    en,
    (language) => import(`../../locales/${language}/chat.sessionHistoryNotice.json`),
)
