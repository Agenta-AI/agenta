import en from "../../locales/en/entityUi.schemaForm.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.schemaForm",
    en,
    (language) => import(`../../locales/${language}/entityUi.schemaForm.json`),
)
