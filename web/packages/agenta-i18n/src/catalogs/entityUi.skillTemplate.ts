import en from "../../locales/en/entityUi.skillTemplate.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.skillTemplate",
    en,
    (language) => import(`../../locales/${language}/entityUi.skillTemplate.json`),
)
