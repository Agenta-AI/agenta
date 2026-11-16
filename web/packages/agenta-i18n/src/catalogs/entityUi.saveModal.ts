import en from "../../locales/en/entityUi.saveModal.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.saveModal",
    en,
    (language) => import(`../../locales/${language}/entityUi.saveModal.json`),
)
