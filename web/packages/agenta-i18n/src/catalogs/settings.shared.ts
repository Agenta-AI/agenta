import en from "../../locales/en/settings.shared.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.shared",
    en,
    (language) => import(`../../locales/${language}/settings.shared.json`),
)
