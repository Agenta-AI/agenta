import en from "../../locales/en/entityUi.triggerShared.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.triggerShared",
    en,
    (language) => import(`../../locales/${language}/entityUi.triggerShared.json`),
)
