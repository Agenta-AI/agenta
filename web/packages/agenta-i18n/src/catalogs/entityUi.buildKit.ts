import en from "../../locales/en/entityUi.buildKit.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.buildKit",
    en,
    (language) => import(`../../locales/${language}/entityUi.buildKit.json`),
)
