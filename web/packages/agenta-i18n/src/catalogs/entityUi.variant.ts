import en from "../../locales/en/entityUi.variant.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.variant",
    en,
    (language) => import(`../../locales/${language}/entityUi.variant.json`),
)
