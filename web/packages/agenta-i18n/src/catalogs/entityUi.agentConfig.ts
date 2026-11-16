import en from "../../locales/en/entityUi.agentConfig.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.agentConfig",
    en,
    (language) => import(`../../locales/${language}/entityUi.agentConfig.json`),
)
