import en from "../../locales/en/ui.chat.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "ui.chat",
    en,
    (language) => import(`../../locales/${language}/ui.chat.json`),
)
