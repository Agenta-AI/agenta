import en from "../../locales/en/settings.account.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.account",
    en,
    (language) => import(`../../locales/${language}/settings.account.json`),
)
