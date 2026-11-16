import en from "../../locales/en/observabilityUi.export.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.export",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.export.json`),
)
