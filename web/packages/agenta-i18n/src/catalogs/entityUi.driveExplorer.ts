import en from "../../locales/en/entityUi.driveExplorer.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.driveExplorer",
    en,
    (language) => import(`../../locales/${language}/entityUi.driveExplorer.json`),
)
