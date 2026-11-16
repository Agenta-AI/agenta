import en from "../../locales/en/entityUi.changeSections.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.changeSections",
    en,
    (language) => import(`../../locales/${language}/entityUi.changeSections.json`),
)
