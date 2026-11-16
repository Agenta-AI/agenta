import en from "../../locales/en/observability.addToTestset.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observability.addToTestset",
    en,
    (language) => import(`../../locales/${language}/observability.addToTestset.json`),
)
