import en from "../../locales/en/entityUi.presetModal.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.presetModal",
    en,
    (language) => import(`../../locales/${language}/entityUi.presetModal.json`),
)
