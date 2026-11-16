import en from "../../locales/en/chat.mobileSessions.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.mobileSessions",
    en,
    (language) => import(`../../locales/${language}/chat.mobileSessions.json`),
)
