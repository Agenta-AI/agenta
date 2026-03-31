/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * This file is adapted from Meta's Lexical project:
 * https://github.com/facebook/lexical
 */

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {TreeView} from "@lexical/react/LexicalTreeView"

export const DebugPlugin = () => {
    const [editor] = useLexicalComposerContext()

    return (
        <div className="border-t p-4">
            <h3 className="text-sm font-semibold mb-2">Debug View</h3>
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
