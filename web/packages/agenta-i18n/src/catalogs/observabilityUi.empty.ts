import en from "../../locales/en/observabilityUi.empty.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.empty",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.empty.json`),
)
