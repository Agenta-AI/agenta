import en from "../../locales/en/settings.domainDnsInstructions.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.domainDnsInstructions",
    en,
    (language) => import(`../../locales/${language}/settings.domainDnsInstructions.json`),
)
