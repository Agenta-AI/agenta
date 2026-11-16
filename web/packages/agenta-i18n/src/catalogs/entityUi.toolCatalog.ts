import en from "../../locales/en/entityUi.toolCatalog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.toolCatalog",
    en,
    (language) => import(`../../locales/${language}/entityUi.toolCatalog.json`),
)
