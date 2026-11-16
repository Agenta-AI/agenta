import en from "../../locales/en/observabilityUi.filters.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.filters",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.filters.json`),
)
