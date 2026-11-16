import en from "../../locales/en/ui.table.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "ui.table",
    en,
    (language) => import(`../../locales/${language}/ui.table.json`),
)
