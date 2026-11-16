import en from "../../locales/en/observabilityUi.traceDrawer.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.traceDrawer",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.traceDrawer.json`),
)
