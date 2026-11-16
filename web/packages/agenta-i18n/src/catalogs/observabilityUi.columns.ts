import en from "../../locales/en/observabilityUi.columns.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.columns",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.columns.json`),
)
