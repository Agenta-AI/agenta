import en from "../../locales/en/observability.annotate.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observability.annotate",
    en,
    (language) => import(`../../locales/${language}/observability.annotate.json`),
)
