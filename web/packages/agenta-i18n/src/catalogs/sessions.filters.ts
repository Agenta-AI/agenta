import en from "../../locales/en/sessions.filters.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "sessions.filters",
    en,
    (language) => import(`../../locales/${language}/sessions.filters.json`),
)
