import {randString} from "../../src/lib/helpers/utils"

describe("Regex Evaluation workflow", () => {
    let app_v2 = randString(5)
    let app_id
    before(() => {
        cy.createVariantsAndTestsets()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("When", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/playground`)
        })

        it("Should", () => {
            cy.clickLinkAndWait("button.ant-tabs-nav-add")
            cy.get('[data-cy="new-variant-modal"]').should("exist")
            cy.get('[data-cy="new-variant-modal-select"]').click()
            cy.get('[data-cy^="new-variant-modal-label"]').contains("app.default").click()
            cy.get('[data-cy="new-variant-modal-input"]').type(app_v2)
            cy.get('[data-cy="new-variant-modal"]').within(() => {
                cy.get("button.ant-btn").contains(/ok/i).click()
            })
            cy.url().should("include", `/playground?variant=app.${app_v2}`)
            cy.get('[data-cy="playground-save-changes-button"]').eq(1).click()
            cy.get('[data-cy="playground-publish-button"]').should("exist")
            cy.get(".ant-message-notice-content").should("exist")
        })

        it("Should check if user has more than one variant", () => {
            cy.get(".ant-tabs-nav-list").within(() => {
                cy.get(".ant-tabs-tab").should("have.length.gt", 1)
            })
        })
    })

    context("When Variant and Testset are Selected", () => {
        it("Should", () => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.clickLinkAndWait('[data-cy="abTesting-button"]')

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get(".ant-dropdown")
                .eq(0)
                .within(() => {
                    cy.get('[data-cy="variant-0"]').contains("app.default").click()
                })
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="variants-dropdown-1"]').trigger("mouseover")
            cy.get(".ant-dropdown")
                .eq(1)
                .within(() => {
                    cy.get('[data-cy="variant-1"]').contains(`app.${app_v2}`).click()
                })
            cy.get('[data-cy="variants-dropdown-1"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get(".ant-dropdown")
                .eq(2)
                .within(() => {
                    cy.get('[data-cy="testset-0"]').click()
                })
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.url().should("include", "/human_a_b_testing")
            cy.wait(1000)
            cy.get('[data-cy="abTesting-run-all-button"]').click()
            cy.get('[data-cy^="abTesting-app-variant-1-vote-button"]', {timeout: 15000}).should(
                "not.be.disabled",
            )
            cy.get('[data-cy^="abTesting-app-variant-2-vote-button"]', {timeout: 15000}).should(
                "not.be.disabled",
            )
            cy.get('[data-cy^="abTesting-both-bad-vote-button"]', {timeout: 15000}).should(
                "not.be.disabled",
            )

            cy.get(".ant-message-notice-content").should("exist")

            cy.get('[data-cy="abTesting-app-variant-1-vote-button-0"]').click()
            cy.get('[data-cy="abTesting-app-variant-2-vote-button-1"]').click()
            cy.get('[data-cy="abTesting-both-bad-vote-button-2"]').click()
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
