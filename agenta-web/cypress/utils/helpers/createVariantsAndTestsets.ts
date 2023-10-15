import {randString} from "../../../src/lib/helpers/utils"

export let app_id
export function createVariantsAndTestsets() {
    context("When creating variants and testsets", () => {
        it("Should successfully create app variant", () => {
            cy.visit("/settings")
            cy.get('[data-cy="openai-api-input"]').type(`${Cypress.env("OPENAI_API_KEY")}`)
            cy.get('[data-cy="openai-api-save"]').click()
            cy.visit("/apps")
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
            cy.intercept("POST", "/api/apps/app_and_variant_from_template/").as("postRequest")
            cy.wait("@postRequest", {requestTimeout: 15000}).then((interception) => {
                expect(interception.response.statusCode).to.eq(200)

                cy.intercept("GET", `/api/apps/${interception.response.body.app_id}/variants/`).as(
                    "getRequest",
                )
                cy.wait("@getRequest", {requestTimeout: 15000}).then((interception) => {
                    expect(interception.response.statusCode).to.eq(200)
                })
                cy.url().should("include", `/apps/${interception.response.body.app_id}/playground`)
                app_id = interception.response.body.app_id
            })
        })

        it("Should successfully create testset", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
            cy.clickLinkAndWait('[data-cy="testset-new-manual-link"]')
            const testsetName = randString(5)

            cy.get('[data-cy="testset-name-input"]').type(testsetName)

            cy.get(".ag-row")
                .eq(0)
                .within(() => {
                    cy.get("div.ag-cell")
                        .eq(1)
                        .within(() => {
                            cy.get("span").eq(0).dblclick()
                            cy.get(".ag-input-field-input").type("Germany")
                        })
                })
            cy.get(".ag-row")
                .eq(1)
                .within(() => {
                    cy.get("div.ag-cell")
                        .eq(1)
                        .within(() => {
                            cy.get("span").eq(0).dblclick()
                            cy.get(".ag-input-field-input").type("Sweden")
                        })
                })
            cy.get(".ag-row")
                .eq(2)
                .within(() => {
                    cy.get("div.ag-cell")
                        .eq(1)
                        .within(() => {
                            cy.get("span").eq(0).dblclick()
                            cy.get(".ag-input-field-input").type("France")
                        })
                })
            cy.get('[data-cy="testset-save-button"]').click()
        })
    })
}
