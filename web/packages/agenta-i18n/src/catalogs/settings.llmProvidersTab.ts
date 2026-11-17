import en from "../../locales/en/settings.llmProvidersTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.llmProvidersTab",
    en,
    (language) => import(`../../locales/${language}/settings.llmProvidersTab.json`),
)
