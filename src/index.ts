import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { 
  FileEditor, 
  IEditorTracker 
} from '@jupyterlab/fileeditor';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { ICommandPalette } from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IStatusBar } from '@jupyterlab/statusbar';
import { Cell } from '@jupyterlab/cells';
import { ICodeMirror } from '@jupyterlab/codemirror';

import '../style/index.css';
function setup_cell_editor(cell: Cell): void {
    if ((cell !== null) && (cell.model.type == "code")) {
      let editor = extract_editor(cell);
      for (let i = 0; i < editor.lineCount(); i++) {
          let line = editor.getLine(i);
          console.log(line);
        }
    }
}

function extract_editor(cell_or_editor: Cell | FileEditor): CodeMirror.Editor {
  let editor_temp = cell_or_editor.editor;
  // @ts-ignore
  return editor_temp._editor;
}

/**
 * Activate extension
 */
function activate(
  app: JupyterFrontEnd,
  tracker: INotebookTracker,
  editor_tracker: IEditorTracker,
  setting_registry: ISettingRegistry,
  code_mirror: ICodeMirror,
  palette: ICommandPalette,
  status_bar: IStatusBar
): void {
  console.log('Attempting to load Copy Code Trace Plugin 3');
  //const command: string = 'copy:code'
  /*app.commands.addCommand(command, {
      label: 'CCT',
  execute: () => {
      const sp = new CopyCode(app, tracker, editor_tracker, setting_registry, code_mirror, palette, status_bar);
      console.log("CopyCode: ",sp)
  }});
  palette.addItem({command, category: 'Tutorial'});*/
}

/**
 * Initialization data for the jupyterlab_spellchecker extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: '@ijmbarr/jupyterlab_spellchecker:plugin',
  autoStart: true,
  requires: [INotebookTracker, IEditorTracker, ISettingRegistry, ICodeMirror],
  optional: [ICommandPalette, IStatusBar],
  activate: activate
};

NotebookActions.executed.connect((thisNotebook, args) => {
  const { cell } = args;
  //const{ notebook } = thisNotebook;
  setup_cell_editor(cell);
  //console.log(notebook.sessionContext);
});

export default extension;
