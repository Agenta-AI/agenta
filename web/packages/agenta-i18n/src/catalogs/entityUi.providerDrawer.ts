import en from "../../locales/en/entityUi.providerDrawer.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.providerDrawer",
    en,
    (language) => import(`../../locales/${language}/entityUi.providerDrawer.json`),
)
