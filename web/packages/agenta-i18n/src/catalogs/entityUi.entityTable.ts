import en from "../../locales/en/entityUi.entityTable.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.entityTable",
    en,
    (language) => import(`../../locales/${language}/entityUi.entityTable.json`),
)
