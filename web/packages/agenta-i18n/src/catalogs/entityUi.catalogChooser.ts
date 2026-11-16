import en from "../../locales/en/entityUi.catalogChooser.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.catalogChooser",
    en,
    (language) => import(`../../locales/${language}/entityUi.catalogChooser.json`),
)
