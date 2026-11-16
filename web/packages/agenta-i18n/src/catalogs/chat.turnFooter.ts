import en from "../../locales/en/chat.turnFooter.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.turnFooter",
    en,
    (language) => import(`../../locales/${language}/chat.turnFooter.json`),
)
