import en from "../../locales/en/chat.composerQuotes.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.composerQuotes",
    en,
    (language) => import(`../../locales/${language}/chat.composerQuotes.json`),
)
