import en from "../../locales/en/settings.apiKeys.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.apiKeys",
    en,
    (language) => import(`../../locales/${language}/settings.apiKeys.json`),
)
