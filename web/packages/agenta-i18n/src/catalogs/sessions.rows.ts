import en from "../../locales/en/sessions.rows.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "sessions.rows",
    en,
    (language) => import(`../../locales/${language}/sessions.rows.json`),
)
