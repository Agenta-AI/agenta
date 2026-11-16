import en from "../../locales/en/observabilityUi.toolbar.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.toolbar",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.toolbar.json`),
)
