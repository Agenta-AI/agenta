import en from "../../locales/en/entityUi.triggerSchedule.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.triggerSchedule",
    en,
    (language) => import(`../../locales/${language}/entityUi.triggerSchedule.json`),
)
