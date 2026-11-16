import en from "../../locales/en/sessions.status.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "sessions.status",
    en,
    (language) => import(`../../locales/${language}/sessions.status.json`),
)
