import en from "../../locales/en/chat.connectionWarningStrip.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.connectionWarningStrip",
    en,
    (language) => import(`../../locales/${language}/chat.connectionWarningStrip.json`),
)
