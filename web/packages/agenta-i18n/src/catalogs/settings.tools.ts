import en from "../../locales/en/settings.tools.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.tools",
    en,
    (language) => import(`../../locales/${language}/settings.tools.json`),
)
