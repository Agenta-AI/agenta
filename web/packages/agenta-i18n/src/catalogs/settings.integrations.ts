import en from "../../locales/en/settings.integrations.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.integrations",
    en,
    (language) => import(`../../locales/${language}/settings.integrations.json`),
)
