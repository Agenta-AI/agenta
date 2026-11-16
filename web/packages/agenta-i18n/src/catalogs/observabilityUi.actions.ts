import en from "../../locales/en/observabilityUi.actions.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.actions",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.actions.json`),
)
