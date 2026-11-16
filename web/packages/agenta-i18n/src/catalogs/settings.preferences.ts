import en from "../../locales/en/settings.preferences.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.preferences",
    en,
    (language) => import(`../../locales/${language}/settings.preferences.json`),
)
