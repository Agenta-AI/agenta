import en from "../../locales/en/entityUi.workflowReference.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.workflowReference",
    en,
    (language) => import(`../../locales/${language}/entityUi.workflowReference.json`),
)
