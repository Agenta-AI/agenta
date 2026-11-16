import en from "../../locales/en/entityUi.selection.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.selection",
    en,
    (language) => import(`../../locales/${language}/entityUi.selection.json`),
)
