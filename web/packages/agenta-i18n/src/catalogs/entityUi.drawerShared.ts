import en from "../../locales/en/entityUi.drawerShared.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.drawerShared",
    en,
    (language) => import(`../../locales/${language}/entityUi.drawerShared.json`),
)
