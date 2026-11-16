import en from "../../locales/en/entityUi.clientTools.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.clientTools",
    en,
    (language) => import(`../../locales/${language}/entityUi.clientTools.json`),
)
