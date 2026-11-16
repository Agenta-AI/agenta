import en from "../../locales/en/entityUi.triggerConnect.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.triggerConnect",
    en,
    (language) => import(`../../locales/${language}/entityUi.triggerConnect.json`),
)
