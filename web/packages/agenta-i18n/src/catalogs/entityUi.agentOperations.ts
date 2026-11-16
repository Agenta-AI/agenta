import en from "../../locales/en/entityUi.agentOperations.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.agentOperations",
    en,
    (language) => import(`../../locales/${language}/entityUi.agentOperations.json`),
)
