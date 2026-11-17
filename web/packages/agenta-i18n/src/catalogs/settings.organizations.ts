import en from "../../locales/en/settings.organizations.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.organizations",
    en,
    (language) => import(`../../locales/${language}/settings.organizations.json`),
)
