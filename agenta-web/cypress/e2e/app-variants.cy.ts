import {randString} from "../../src/lib/helpers/utils"

describe("Test App variant", () => {
    let app_v2 = randString(5)
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("When testing the app variant", () => {
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

        it("Should delete the created app variant", () => {
            cy.get(`[data-node-key="app.${app_v2}"]`).contains(`app.${app_v2}`).click()
            cy.url().should("include", `/playground?variant=app.${app_v2}`)
            cy.get('[data-cy="playground-delete-variant-button"]').eq(1).click()
            cy.get(".ant-modal-content").within(() => {
                cy.get(".ant-modal-confirm-btns > .ant-btn-primary").contains(/yes/i).click()
            })
        })

        it("Should verify there is only one variant present", () => {
            cy.get(".ant-tabs-nav-list").within(() => {
                cy.get(".ant-tabs-tab").should("have.length.lte", 1)
            })
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
