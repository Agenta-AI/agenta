import {randString} from "../../src/lib/helpers/utils"

describe("Playgroynd | Simple prompt", function () {
    context("when entering an invalid case format in the app name", () => {
        it("should fail", () => {
            cy.visit("/apps")
            cy.get('[data-cy="add-new-app-modal"]').should("not.exist")
            cy.get('[data-cy="choose-template-modal"]').should("not.exist")
            cy.get('[data-cy="enter-app-name-modal"]').should("not.exist")
            cy.get('[data-cy="create-new-app-button"]').click()
            cy.get('[data-cy="add-new-app-modal"]').should("exist")
            cy.get('[data-cy="create-from-template"]').click()
            cy.get('[data-cy="choose-template-modal"]').should("exist")
            cy.get('[data-cy="create-app-button"]').click()
            const appName = randString(3)
            cy.get('[data-cy="enter-app-name-modal-text-warning"]').should("not.exist")
            cy.get('[data-cy="enter-app-name-modal"]')
                .should("exist")
                .within(() => {
                    cy.get("input").type(`${appName} ${appName}`)
                })
            cy.get('[data-cy="enter-app-name-modal-text-warning"]').should("exist")
        })
    })

    context("when an api key is provided", function () {
        it("should run the prompt and get a response from an LLM", () => {
            cy.visit("/apikeys")
            // Update your cypress.json file to include your OPENAI API KEY
            cy.get('[data-cy="apikeys-input"]').type(`${Cypress.env("OPENAI_API_KEY")}`)
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
            })
            cy.intercept(
                "GET",
                ` http://localhost/api/app_variant/list_variants/?app_name=${appName}`,
            ).as("getRequest")
            cy.wait("@getRequest", {requestTimeout: 15000}).then((interception) => {
                expect(interception.response.statusCode).to.eq(200)
            })

            cy.url().should("include", `/apps/${appName}/playground`)
            cy.contains(/modify parameters/i)
            cy.get('[data-cy="testview-input-parameters-0"]').type("Nigeria")
            cy.get('[data-cy="testview-input-parameters-run-button"]').click()

            cy.request({
                method: "GET",
                url: `http://localhost/api/containers/container_url/?app_name=${appName}&variant_name=v1`,
            }).then((response) => {
                cy.request({
                    method: "POST",
                    url: `http://localhost/${response.body.uri}/generate`,
                }).then((response) => {
                    expect(response.status).to.eq(200)
                })
            })
        })
    })

    context("when an api key is not provided", function () {
        it("should display error notification", () => {
            cy.visit("/apps")
            cy.get(".ant-notification").should("not.exist")
            cy.get('[data-cy="add-new-app-modal"]').should("not.exist")
            cy.get('[data-cy="choose-template-modal"]').should("not.exist")
            cy.get('[data-cy="enter-app-name-modal"]').should("not.exist")
            cy.get('[data-cy="create-new-app-button"]').click()
            cy.get('[data-cy="add-new-app-modal"]').should("exist")
            cy.get('[data-cy="create-from-template"]').click()
            cy.get('[data-cy="choose-template-modal"]').should("exist")
            cy.get('[data-cy="create-app-button"]').click()
            const appName = randString(5)

            cy.get('[data-cy="enter-app-name-modal"]')
                .should("exist")
                .within(() => {
                    cy.get("input").type(appName)
                })

            cy.get('[data-cy="enter-app-name-modal-button"]').click()
            cy.get(".ant-notification").should("exist")
            cy.url().should("include", "apikeys")
            cy.wait(5000)
            cy.get(".ant-notification").should("not.exist")
        })
    })
})
