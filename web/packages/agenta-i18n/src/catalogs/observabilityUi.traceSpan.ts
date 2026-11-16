import en from "../../locales/en/observabilityUi.traceSpan.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.traceSpan",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.traceSpan.json`),
)
