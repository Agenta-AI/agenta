import en from "../../locales/en/settings.providers.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.providers",
    en,
    (language) => import(`../../locales/${language}/settings.providers.json`),
)
