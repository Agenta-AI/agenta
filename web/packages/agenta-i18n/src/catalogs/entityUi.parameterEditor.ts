import en from "../../locales/en/entityUi.parameterEditor.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.parameterEditor",
    en,
    (language) => import(`../../locales/${language}/entityUi.parameterEditor.json`),
)
