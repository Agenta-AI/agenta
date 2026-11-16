import en from "../../locales/en/entityUi.drivePreview.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.drivePreview",
    en,
    (language) => import(`../../locales/${language}/entityUi.drivePreview.json`),
)
