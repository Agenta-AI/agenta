import en from "../../locales/en/entityUi.secretForm.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.secretForm",
    en,
    (language) => import(`../../locales/${language}/entityUi.secretForm.json`),
)
