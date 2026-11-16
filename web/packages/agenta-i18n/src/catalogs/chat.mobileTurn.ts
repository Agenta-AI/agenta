import en from "../../locales/en/chat.mobileTurn.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.mobileTurn",
    en,
    (language) => import(`../../locales/${language}/chat.mobileTurn.json`),
)
