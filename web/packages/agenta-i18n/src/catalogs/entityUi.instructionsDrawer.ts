import en from "../../locales/en/entityUi.instructionsDrawer.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.instructionsDrawer",
    en,
    (language) => import(`../../locales/${language}/entityUi.instructionsDrawer.json`),
)
