/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * This file is adapted from Meta's Lexical project:
 * https://github.com/facebook/lexical
 */

import {useT} from "@agenta/i18n"
import uiEditorCatalog from "@agenta/i18n/catalogs/ui.editor"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {TreeView} from "@lexical/react/LexicalTreeView"

export const DebugPlugin = () => {
    const [editor] = useLexicalComposerContext()
    const t = useT(uiEditorCatalog)

    return (
        <div className="border-0 border-t border-solid p-4">
            <h3 className="text-sm font-semibold mb-2">{t("ui.editor.debugView")}</h3>
            <TreeView
                viewClassName="tree-view-output"
                treeTypeButtonClassName="debug-treetype-button"
                timeTravelPanelClassName="debug-timetravel-panel"
                timeTravelButtonClassName="debug-timetravel-button"
                timeTravelPanelSliderClassName="debug-timetravel-panel-slider"
                timeTravelPanelButtonClassName="debug-timetravel-panel-button"
                editor={editor}
            />
        </div>
    )
}
