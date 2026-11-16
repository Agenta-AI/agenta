import en from "../../locales/en/entityUi.schemaControls.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.schemaControls",
    en,
    (language) => import(`../../locales/${language}/entityUi.schemaControls.json`),
)
