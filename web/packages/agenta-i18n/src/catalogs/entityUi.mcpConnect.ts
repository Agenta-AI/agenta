import en from "../../locales/en/entityUi.mcpConnect.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.mcpConnect",
    en,
    (language) => import(`../../locales/${language}/entityUi.mcpConnect.json`),
)
