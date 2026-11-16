import en from "../../locales/en/sessions.tabs.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "sessions.tabs",
    en,
    (language) => import(`../../locales/${language}/sessions.tabs.json`),
)
