import en from "../../locales/en/entityUi.workflowTag.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.workflowTag",
    en,
    (language) => import(`../../locales/${language}/entityUi.workflowTag.json`),
)
