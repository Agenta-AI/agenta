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
