import en from "../../locales/en/entityUi.driveRail.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.driveRail",
    en,
    (language) => import(`../../locales/${language}/entityUi.driveRail.json`),
)
