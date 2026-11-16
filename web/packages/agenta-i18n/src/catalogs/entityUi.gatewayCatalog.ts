import en from "../../locales/en/entityUi.gatewayCatalog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.gatewayCatalog",
    en,
    (language) => import(`../../locales/${language}/entityUi.gatewayCatalog.json`),
)
