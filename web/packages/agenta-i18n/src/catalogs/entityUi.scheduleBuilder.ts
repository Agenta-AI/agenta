import en from "../../locales/en/entityUi.scheduleBuilder.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.scheduleBuilder",
    en,
    (language) => import(`../../locales/${language}/entityUi.scheduleBuilder.json`),
)
