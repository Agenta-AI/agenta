import {randString} from "../../src/lib/helpers/utils"

describe("Single Model Test workflow", () => {
    let app_id
    let testset_name
    const saved_testset_name = randString(8)
    before(() => {
        cy.createVariantsAndTestsets()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get("@testsetName").then((testsetName) => {
            testset_name = testsetName
        })
    })

    context("When executing the evaluation", () => {
        it("Should successfully execute the evaluation process", () => {
            cy.visit(`/apps/${app_id}/evaluations?selectedEvaluation=human_annotation`)
            cy.url().should("include", "/evaluations?selectedEvaluation=human_annotation")
            cy.clickLinkAndWait('[data-cy="new-human-eval-modal-button"]')

            cy.get(".ant-modal-content").should("exist")

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy^="testset"]').contains(testset_name).click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.url().should("include", "/single_model_test")
            cy.get('[data-cy="evalInstructionsShown-ok-btn"]').click()

            cy.get('[data-cy="evaluation-vote-panel-numeric-vote-input"]').should("not.exist")

            cy.intercept("POST", "**/app/generate", {
                statusCode: 200,
                fixture: "single-prompt-openai/human-evaluation.json",
            }).as("generateRequest")

            cy.wait(1000)
            cy.get('[data-cy="single-model-run-all-button"]').click()
            cy.get('[data-cy="evaluation-vote-panel-numeric-vote-input"]').type("100")
        })

        it("Should modify the evaluation vote scores", () => {
            cy.visit(`/apps/${app_id}/evaluations?selectedEvaluation=human_annotation`)
            cy.url().should("include", "/evaluations?selectedEvaluation=human_annotation")
            cy.wait(1000)
            cy.clickLinkAndWait(".ant-table-row").eq(0)
            cy.get('[data-cy="evalInstructionsShown-ok-btn"]').click()
            cy.get('[data-cy="evaluation-vote-panel-numeric-vote-input"]').clear()
            cy.get('[data-cy="evaluation-vote-panel-numeric-vote-input"]').type("85")
            cy.get('[data-cy="single-model-save-testset-button"]').click()
            cy.get(".ant-modal-content").contains("Add new test set").should("be.visible")
            cy.get('[data-cy="single-model-save-testset-modal-input"]').type(saved_testset_name)
            cy.get(".ant-modal-footer > .ant-btn-primary").contains("Submit").click()
            cy.wait(1000)
        })

        it("Should check the evaluation testset is successfully saved", () => {
            cy.visit(`/testsets`)
            cy.url().should("include", "/testsets")
            cy.get('[data-cy="app-testset-list"]').as("table")
            cy.get("@table").contains(saved_testset_name).as("tempTestSet").should("be.visible")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
