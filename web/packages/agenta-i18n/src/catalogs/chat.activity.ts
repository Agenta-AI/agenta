import en from "../../locales/en/chat.activity.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.activity",
    en,
    (language) => import(`../../locales/${language}/chat.activity.json`),
)
