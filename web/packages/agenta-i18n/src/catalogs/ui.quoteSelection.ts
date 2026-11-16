import en from "../../locales/en/ui.quoteSelection.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "ui.quoteSelection",
    en,
    (language) => import(`../../locales/${language}/ui.quoteSelection.json`),
)
