import en from "../../locales/en/settings.addDomainDialog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.addDomainDialog",
    en,
    (language) => import(`../../locales/${language}/settings.addDomainDialog.json`),
)
