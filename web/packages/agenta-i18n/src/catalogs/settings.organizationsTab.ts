import en from "../../locales/en/settings.organizationsTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.organizationsTab",
    en,
    (language) => import(`../../locales/${language}/settings.organizationsTab.json`),
)
