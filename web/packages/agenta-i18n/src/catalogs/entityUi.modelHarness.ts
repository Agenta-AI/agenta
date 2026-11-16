import en from "../../locales/en/entityUi.modelHarness.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.modelHarness",
    en,
    (language) => import(`../../locales/${language}/entityUi.modelHarness.json`),
)
