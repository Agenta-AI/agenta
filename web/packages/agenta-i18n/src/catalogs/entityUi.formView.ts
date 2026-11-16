import en from "../../locales/en/entityUi.formView.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.formView",
    en,
    (language) => import(`../../locales/${language}/entityUi.formView.json`),
)
