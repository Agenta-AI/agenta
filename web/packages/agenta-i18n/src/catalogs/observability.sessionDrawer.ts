import en from "../../locales/en/observability.sessionDrawer.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "observability.sessionDrawer",
    en,
    (language) => import(`../../locales/${language}/observability.sessionDrawer.json`),
)
