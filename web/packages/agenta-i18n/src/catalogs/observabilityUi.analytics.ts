import en from "../../locales/en/observabilityUi.analytics.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.analytics",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.analytics.json`),
)
