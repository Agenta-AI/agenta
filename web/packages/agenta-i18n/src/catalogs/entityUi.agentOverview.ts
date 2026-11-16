import en from "../../locales/en/entityUi.agentOverview.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.agentOverview",
    en,
    (language) => import(`../../locales/${language}/entityUi.agentOverview.json`),
)
