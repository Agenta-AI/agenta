import en from "../../locales/en/settings.accessErrors.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.accessErrors",
    en,
    (language) => import(`../../locales/${language}/settings.accessErrors.json`),
)
