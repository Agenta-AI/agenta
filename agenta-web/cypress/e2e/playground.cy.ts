import {randString} from "../../src/lib/helpers/utils"

describe("run a simple prompt", () => {
    beforeEach(() => {
        cy.visit("/apikeys")
        // Update your cypress.json file to include your OPENAI API KEY
        cy.get('[data-cy="apikeys-input"]').type(Cypress.env("OPENAI_API_KEY"))
        cy.get('[data-cy="apikeys-save-button"]').click()
        cy.visit("/apps")
        cy.get('[data-cy="add-new-app-modal"]').should("not.exist")
        cy.get('[data-cy="choose-template-modal"]').should("not.exist")
        cy.get('[data-cy="enter-app-name-modal"]').should("not.exist")
        cy.get('[data-cy="create-new-app-button"]').click()
        cy.get('[data-cy="add-new-app-modal"]').should("exist")
        cy.get('[data-cy="create-from-template"]').click()
        cy.get('[data-cy="choose-template-modal"]').should("exist")
        cy.get('[data-cy="create-app-button"]').click()
    })

    it("displays a warning when entering an invalid case format in the app name", () => {
        const appName = randString(3)
        cy.get('[data-cy="enter-app-name-modal-text-warning"]').should("not.exist")
        cy.get('[data-cy="enter-app-name-modal"]')
            .should("exist")
            .within(() => {
                cy.get("input").type(`${appName} ${appName}`)
            })
        cy.get('[data-cy="enter-app-name-modal-text-warning"]').should("exist")
    })

    it("should create a new app variant and run playground prompt", () => {
        const appName = randString(5)

        cy.get('[data-cy="enter-app-name-modal"]')
            .should("exist")
            .within(() => {
                cy.get("input").type(appName)
            })

        cy.get('[data-cy="enter-app-name-modal-button"]').click()

        cy.url().should("not.include", "/apikeys")

        cy.intercept("POST", "http://localhost/api/app_variant/add/from_template/").as(
            "postRequest",
        )

        cy.wait("@postRequest", {requestTimeout: 15000}).then((interception) => {
            expect(interception.response.statusCode).to.eq(200)

            const locationHeader = interception.response.body.data.playground
            expect(locationHeader).to.eq(`http://localhost:3000/apps/${appName}/playground`)
        })
        cy.wait(10000)
        cy.url().should("include", `/apps/${appName}/playground`)
        cy.contains(/modify parameters/i)
        cy.get('[data-cy="testview-input-parameters-0"]').type("Nigeria")
        cy.get('[data-cy="testview-input-parameters-run-button"]').click()
        cy.get('[data-cy="testview-input-parameters-result"]').should(
            "not.contain.text",
            "The code has resulted in the following error",
        )
    })
})
