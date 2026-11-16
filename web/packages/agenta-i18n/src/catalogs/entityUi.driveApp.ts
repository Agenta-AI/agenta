import en from "../../locales/en/entityUi.driveApp.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.driveApp",
    en,
    (language) => import(`../../locales/${language}/entityUi.driveApp.json`),
)
