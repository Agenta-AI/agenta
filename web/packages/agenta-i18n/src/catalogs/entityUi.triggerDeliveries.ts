import en from "../../locales/en/entityUi.triggerDeliveries.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.triggerDeliveries",
    en,
    (language) => import(`../../locales/${language}/entityUi.triggerDeliveries.json`),
)
