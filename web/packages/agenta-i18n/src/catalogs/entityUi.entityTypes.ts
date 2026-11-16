import en from "../../locales/en/entityUi.entityTypes.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.entityTypes",
    en,
    (language) => import(`../../locales/${language}/entityUi.entityTypes.json`),
)
