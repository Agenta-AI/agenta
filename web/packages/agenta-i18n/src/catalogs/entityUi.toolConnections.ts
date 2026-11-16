import en from "../../locales/en/entityUi.toolConnections.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.toolConnections",
    en,
    (language) => import(`../../locales/${language}/entityUi.toolConnections.json`),
)
