import en from "../../locales/en/playground.chat.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "playground.chat",
    en,
    (language) => import(`../../locales/${language}/playground.chat.json`),
)
