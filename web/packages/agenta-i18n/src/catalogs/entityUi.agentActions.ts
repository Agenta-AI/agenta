import en from "../../locales/en/entityUi.agentActions.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.agentActions",
    en,
    (language) => import(`../../locales/${language}/entityUi.agentActions.json`),
)
