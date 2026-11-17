import en from "../../locales/en/settings.webhooksTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.webhooksTab",
    en,
    (language) => import(`../../locales/${language}/settings.webhooksTab.json`),
)
