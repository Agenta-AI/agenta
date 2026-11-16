import en from "../../locales/en/entityUi.viewTypes.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.viewTypes",
    en,
    (language) => import(`../../locales/${language}/entityUi.viewTypes.json`),
)
