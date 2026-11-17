import en from "../../locales/en/settings.audit.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.audit",
    en,
    (language) => import(`../../locales/${language}/settings.audit.json`),
)
