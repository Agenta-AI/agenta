import en from "../../locales/en/sessions.sharing.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "sessions.sharing",
    en,
    (language) => import(`../../locales/${language}/sessions.sharing.json`),
)
