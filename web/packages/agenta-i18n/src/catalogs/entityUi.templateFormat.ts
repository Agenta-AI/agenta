import en from "../../locales/en/entityUi.templateFormat.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.templateFormat",
    en,
    (language) => import(`../../locales/${language}/entityUi.templateFormat.json`),
)
