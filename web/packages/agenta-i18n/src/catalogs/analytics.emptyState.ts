import en from "../../locales/en/analytics.emptyState.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "analytics.emptyState",
    en,
    (language) => import(`../../locales/${language}/analytics.emptyState.json`),
)
