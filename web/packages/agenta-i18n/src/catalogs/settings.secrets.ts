import en from "../../locales/en/settings.secrets.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.secrets",
    en,
    (language) => import(`../../locales/${language}/settings.secrets.json`),
)
