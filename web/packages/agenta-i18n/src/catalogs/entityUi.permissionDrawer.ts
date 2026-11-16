import en from "../../locales/en/entityUi.permissionDrawer.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.permissionDrawer",
    en,
    (language) => import(`../../locales/${language}/entityUi.permissionDrawer.json`),
)
