import {tests} from "@agenta/oss/tests/app/create.spec"
import {test as baseTest, tags, createAuthTest} from "tests/tests/app/test"
import {AppType, type AppFixtures} from "tests/tests/app/types"

const test = createAuthTest<AppFixtures>(baseTest)
// Tags can now be added directly to the describe block title
test.describeWithAuth(`App Creation Flow ${tags} @requiresAuth`, () => {
    tests()
})
