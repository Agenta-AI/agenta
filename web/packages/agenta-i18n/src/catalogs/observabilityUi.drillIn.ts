import en from "../../locales/en/observabilityUi.drillIn.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observabilityUi.drillIn",
    en,
    (language) => import(`../../locales/${language}/observabilityUi.drillIn.json`),
)
