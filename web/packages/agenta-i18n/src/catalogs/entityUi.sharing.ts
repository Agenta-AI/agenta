import en from "../../locales/en/entityUi.sharing.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.sharing",
    en,
    (language) => import(`../../locales/${language}/entityUi.sharing.json`),
)
