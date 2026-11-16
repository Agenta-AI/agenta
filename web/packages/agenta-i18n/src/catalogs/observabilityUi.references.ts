import en from "../../locales/en/observabilityUi.references.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.references",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.references.json`),
)
