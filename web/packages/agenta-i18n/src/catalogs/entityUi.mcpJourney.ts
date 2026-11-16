import en from "../../locales/en/entityUi.mcpJourney.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.mcpJourney",
    en,
    (language) => import(`../../locales/${language}/entityUi.mcpJourney.json`),
)
