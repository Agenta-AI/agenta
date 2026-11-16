import en from "../../locales/en/entityUi.mcpDetail.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.mcpDetail",
    en,
    (language) => import(`../../locales/${language}/entityUi.mcpDetail.json`),
)
