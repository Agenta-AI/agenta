import en from "../../locales/en/observability.screen.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observability.screen",
    en,
    (language) => import(`../../locales/${language}/observability.screen.json`),
)
