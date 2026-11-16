import en from "../../locales/en/entityUi.commitModal.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.commitModal",
    en,
    (language) => import(`../../locales/${language}/entityUi.commitModal.json`),
)
