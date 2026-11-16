import en from "../../locales/en/entityUi.toolSelector.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.toolSelector",
    en,
    (language) => import(`../../locales/${language}/entityUi.toolSelector.json`),
)
