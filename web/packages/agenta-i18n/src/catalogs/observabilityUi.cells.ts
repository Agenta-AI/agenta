import en from "../../locales/en/observabilityUi.cells.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.cells",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.cells.json`),
)
