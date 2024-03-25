import {randString} from "../../src/lib/helpers/utils"

describe("A/B Testing Evaluation workflow", () => {
    let app_v2 = randString(5)
    let app_id
    let testset_name
    before(() => {
        cy.createVariantsAndTestsets()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get("@testsetName").then((testsetName) => {
            testset_name = testsetName
        })
    })

    context("When creating an app variant", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/playground`)
        })

        it("Should successfully create a new app variant", () => {
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

        it("Should verify user has more than one app variant", () => {
            cy.get(".ant-tabs-nav-list").within(() => {
                cy.get(".ant-tabs-tab").should("have.length.gt", 1)
            })
        })
    })

    context("When executing the evaluation", () => {
        it("Should successfully execute the evaluation process", () => {
            cy.visit(`/apps/${app_id}/annotations`)
            cy.url().should("include", "/annotations")
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
            cy.get('[data-cy^="testset"]').contains(testset_name).click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.url().should("include", "/human_a_b_testing")
            cy.get('[data-cy="evalInstructionsShown-ok-btn"]').click()

            cy.get('[data-cy="evaluation-vote-panel-comparison-vote-button"]').should("not.exist")
            cy.get(
                '[data-cy="evaluation-vote-panel-comparison-both-bad-vote-button-button"]',
            ).should("not.exist")

            cy.intercept("POST", "**/app/generate", {
                statusCode: 200,
                fixture: "single-prompt-openai/human-evaluation.json",
            }).as("generateRequest")

            cy.wait(1000)
            cy.get('[data-cy="abTesting-run-all-button"]').click()

            cy.wait("@generateRequest")

            cy.get('[data-cy="evaluation-vote-panel-comparison-vote-button"]').eq(0).click()
            cy.get('[data-cy="evaluation-vote-panel-comparison-vote-button"]').eq(1).click()
            cy.get(
                '[data-cy="evaluation-vote-panel-comparison-both-good-vote-button-button"]',
            ).click()
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
