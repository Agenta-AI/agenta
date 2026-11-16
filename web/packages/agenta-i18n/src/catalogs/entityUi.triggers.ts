import en from "../../locales/en/entityUi.triggers.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.triggers",
    en,
    (language) => import(`../../locales/${language}/entityUi.triggers.json`),
)
