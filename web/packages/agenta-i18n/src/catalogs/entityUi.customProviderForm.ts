import en from "../../locales/en/entityUi.customProviderForm.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.customProviderForm",
    en,
    (language) => import(`../../locales/${language}/entityUi.customProviderForm.json`),
)
