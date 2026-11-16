import en from "../../locales/en/entityUi.deleteModal.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.deleteModal",
    en,
    (language) => import(`../../locales/${language}/entityUi.deleteModal.json`),
)
