import en from "../../locales/en/observabilityUi.range.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.range",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.range.json`),
)
