import en from "../../locales/en/entityUi.agentPicker.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.agentPicker",
    en,
    (language) => import(`../../locales/${language}/entityUi.agentPicker.json`),
)
