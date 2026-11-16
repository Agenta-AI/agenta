import en from "../../locales/en/ui.status.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "ui.status",
    en,
    (language) => import(`../../locales/${language}/ui.status.json`),
)
