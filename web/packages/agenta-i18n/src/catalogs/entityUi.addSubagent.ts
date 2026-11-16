import en from "../../locales/en/entityUi.addSubagent.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.addSubagent",
    en,
    (language) => import(`../../locales/${language}/entityUi.addSubagent.json`),
)
