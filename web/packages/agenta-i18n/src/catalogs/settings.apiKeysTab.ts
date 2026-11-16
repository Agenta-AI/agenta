import en from "../../locales/en/settings.apiKeysTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.apiKeysTab",
    en,
    (language) => import(`../../locales/${language}/settings.apiKeysTab.json`),
)
