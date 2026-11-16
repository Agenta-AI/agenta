import en from "../../locales/en/entityUi.toolExecution.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.toolExecution",
    en,
    (language) => import(`../../locales/${language}/entityUi.toolExecution.json`),
)
