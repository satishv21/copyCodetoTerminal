import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { FileEditor, IEditorTracker } from '@jupyterlab/fileeditor';
import { INotebookTracker } from '@jupyterlab/notebook';
import { LabIcon } from '@jupyterlab/ui-components';
import {
  ICommandPalette,
  InputDialog,
  ReactWidget
} from '@jupyterlab/apputils';
import { Menu } from '@lumino/widgets';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IStatusBar, TextItem } from '@jupyterlab/statusbar';
import { Cell } from '@jupyterlab/cells';
import { CodeMirrorEditor, ICodeMirror } from '@jupyterlab/codemirror';

import CodeMirror from 'codemirror';

import '../style/index.css';
import spellcheckSvg from '../style/icons/ic-baseline-spellcheck.svg';

export const spellcheckIcon = new LabIcon({
  name: 'spellcheck:spellcheck',
  svgstr: spellcheckSvg
});

declare function require(name: string): any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Typo = require('typo-js');

const enum CommandIDs {
  applySuggestion = 'spellchecker:apply-suggestion',
  ignoreWord = 'spellchecker:ignore',
  toggle = 'spellchecker:toggle-check-spelling',
  updateSuggestions = 'spellchecker:update-suggestions',
  chooseLanguage = 'spellchecker:choose-language'
}

const TEXT_SUGGESTIONS_AVAILABLE = 'Adjust spelling to';
const TEXT_NO_SUGGESTIONS = 'No spellcheck suggestions';

const PALETTE_CATEGORY = 'Spell Checker';

interface IWord {
  line: number;
  start: number;
  end: number;
  text: string;
}

interface IContext {
  editor: CodeMirror.Editor;
  position: CodeMirror.Position;
}

interface ILanguage {
  code: string;
  name: string;
  aff: string;
  dic: string;
}

// English dictionaries come from https://github.com/en-wl/wordlist
import en_aff from 'file-loader!../dictionaries/en_US.aff';
import en_dic from 'file-loader!../dictionaries/en_US.dic';

import en_gb_aff from 'file-loader!../dictionaries/en_GB-ise.aff';
import en_gb_dic from 'file-loader!../dictionaries/en_GB-ise.dic';

import en_ca_aff from 'file-loader!../dictionaries/en_CA.aff';
import en_ca_dic from 'file-loader!../dictionaries/en_CA.dic';

import en_au_aff from 'file-loader!../dictionaries/en_AU.aff';
import en_au_dic from 'file-loader!../dictionaries/en_AU.dic';

import de_de_aff from 'file-loader!../dictionaries/de_DE_frami.aff';
import de_de_dic from 'file-loader!../dictionaries/de_DE_frami.dic';

import de_at_aff from 'file-loader!../dictionaries/de_AT_frami.aff';
import de_at_dic from 'file-loader!../dictionaries/de_AT_frami.dic';

import de_ch_aff from 'file-loader!../dictionaries/de_CH_frami.aff';
import de_ch_dic from 'file-loader!../dictionaries/de_CH_frami.dic';

import fr_fr_aff from 'file-loader!../dictionaries/fr.aff';
import fr_fr_dic from 'file-loader!../dictionaries/fr.dic';

import es_es_aff from 'file-loader!../dictionaries/es_ES.aff';
import es_es_dic from 'file-loader!../dictionaries/es_ES.dic';

//import it_it_aff from 'file-loader!../dictionaries/it_IT.aff';
//import it_it_dic from 'file-loader!../dictionaries/it_IT.dic';

import pt_pt_aff from 'file-loader!../dictionaries/pt_PT.aff';
import pt_pt_dic from 'file-loader!../dictionaries/pt_PT.dic';

const languages: ILanguage[] = [
  { code: 'en-us', name: 'English (American)', aff: en_aff, dic: en_dic },
  { code: 'en-gb', name: 'English (British)', aff: en_gb_aff, dic: en_gb_dic },
  { code: 'en-ca', name: 'English (Canadian)', aff: en_ca_aff, dic: en_ca_dic },
  {
    code: 'en-au',
    name: 'English (Australian)',
    aff: en_au_aff,
    dic: en_au_dic
  },
  {
    code: 'de-de',
    name: 'Deutsch (Deutschland)',
    aff: de_de_aff,
    dic: de_de_dic
  },
  {
    code: 'de-at',
    name: 'Deutsch (Österreich)',
    aff: de_at_aff,
    dic: de_at_dic
  },
  { code: 'de-ch', name: 'Deutsch (Schweiz)', aff: de_ch_aff, dic: de_ch_dic },
  { code: 'fr-fr', name: 'Français (France)', aff: fr_fr_aff, dic: fr_fr_dic },
  { code: 'es-es', name: 'Español (España)', aff: es_es_aff, dic: es_es_dic },
  //{code: 'it-it', name: 'Italiano (Italia)', aff: it_it_aff, dic: it_it_dic},
  {
    code: 'pt-pt',
    name: 'Português (Portugal)',
    aff: pt_pt_aff,
    dic: pt_pt_dic
  }
];

class StatusWidget extends ReactWidget {
  language_source: () => string;

  constructor(source: () => string) {
    super();
    this.language_source = source;
  }

  protected render() {
    return TextItem({ source: this.language_source() });
  }
}

/**
 * SpellChecker
 */
class CopyCode {
  dictionary: any;
  suggestions_menu: Menu;
  status_widget: StatusWidget;
  status_msg = 'Dictionary not loaded';

  // Default Options
  check_spelling = true;
  language: ILanguage;
  rx_word_char = /[^-[\]{}():/!;&@$£%§<>"*+=?.,~\\^|_`#±\s\t]/;
  rx_non_word_char = /[-[\]{}():/!;&@$£%§<>"*+=?.,~\\^|_`#±\s\t]/;
  ignored_tokens: Set<string> = new Set();
  settings: ISettingRegistry.ISettings;
  accepted_types: string[];

  constructor(
    protected app: JupyterFrontEnd,
    protected tracker: INotebookTracker,
    protected editor_tracker: IEditorTracker,
    protected setting_registry: ISettingRegistry,
    protected code_mirror: ICodeMirror,
    protected palette?: ICommandPalette,
    protected status_bar?: IStatusBar
  ) {
    // have at least a default
    this.language = languages[0];

    // read the settings
    this.setup_settings();

    // setup the static content of the spellchecker UI
    this.setup_button();
    this.setup_suggestions();
    this.setup_language_picker();
    this.setup_ignore_action();

    this.tracker.activeCellChanged.connect(() => {
      if (this.tracker.activeCell) {
        this.setup_cell_editor(this.tracker.activeCell);
      }
    });
    // setup newly open editors
    this.editor_tracker.widgetAdded.connect((sender, widget) =>
      this.setup_file_editor(widget.content, true)
    );
    // refresh already open editors when activated (because the MIME type might have changed)
    this.editor_tracker.currentChanged.connect((sender, widget) => {
      if (widget !== null) {
        this.setup_file_editor(widget.content, false);
      }
    });
  }

  // move the load_dictionary into the setup routine, because then
  // we know that the values are set correctly!
  setup_settings() {
    Promise.all([this.setting_registry.load(extension.id), this.app.restored])
      .then(([settings]) => {
        this.update_settings(settings);
        settings.changed.connect(() => {
          this.update_settings(settings);
        });
      })
      .catch((reason: Error) => {
        console.error(reason.message);
      });
  }

  protected _set_theme(name: string) {
    document.body.setAttribute('data-jp-spellchecker-theme', name);
  }

  update_settings(settings: ISettingRegistry.ISettings) {
    this.settings = settings;
    const tokens = settings.get('ignore').composite as Array<string>;
    this.ignored_tokens = new Set(tokens);
    this.accepted_types = settings.get('mimeTypes').composite as Array<string>;
    const theme = settings.get('theme').composite as string;
    this._set_theme(theme);

    // read the saved language setting
    const language_code = settings.get('language').composite;
    const user_language = languages.filter(l => l.code === language_code)[0];
    if (user_language === undefined) {
      console.warn('The language ' + language_code + ' is not supported!');
    } else {
      this.language = user_language;
      // load the dictionary
      this.load_dictionary().catch(console.warn);
    }
    this.refresh_state();
  }

  setup_file_editor(file_editor: FileEditor, setup_signal = false): void {
    if (
      this.accepted_types &&
      this.accepted_types.indexOf(file_editor.model.mimeType) !== -1
    ) {
      const editor = this.extract_editor(file_editor);
      this.setup_overlay(editor);
    }
    if (setup_signal) {
      file_editor.model.mimeTypeChanged.connect((model, args) => {
        // putting at the end of execution queue to allow the CodeMirror mode to be updated
        setTimeout(() => this.setup_file_editor(file_editor), 0);
      });
    }
  }

  setup_cell_editor(cell: Cell): void {
    if ((cell !== null) && (cell.model.type == "code")) {
      let editor = this.extract_editor(cell);
      for (let i = 0; i <= editor.lineCount(); i++) {
          let line = editor.getLine(i);
          console.log(line);
        }
      //this.setup_overlay(editor);
    }
  }

  extract_editor(cell_or_editor: Cell | FileEditor): CodeMirror.Editor {
    const editor_temp = cell_or_editor.editor as CodeMirrorEditor;
    return editor_temp.editor;
  }

  setup_overlay(editor: CodeMirror.Editor, retry = true): void {
    const current_mode = editor.getOption('mode') as string;

    if (current_mode === 'null') {
      if (retry) {
        // putting at the end of execution queue to allow the CodeMirror mode to be updated
        setTimeout(() => this.setup_overlay(editor, false), 0);
      }
      return;
    }

    if (this.check_spelling) {
      editor.setOption('mode', this.define_mode(current_mode));
    } else {
      const original_mode = current_mode.match(/^spellcheck_/)
        ? current_mode.substr(11)
        : current_mode;
      editor.setOption('mode', original_mode);
    }
  }

  toggle_spellcheck() {
    this.check_spelling = !this.check_spelling;
    console.log('Spell checking is currently: ', this.check_spelling);
  }

  setup_button() {
    this.app.commands.addCommand(CommandIDs.toggle, {
      label: 'Toggle spellchecker',
      execute: () => {
        this.toggle_spellcheck();
      }
    });
    if (this.palette) {
      this.palette.addItem({
        command: CommandIDs.toggle,
        category: PALETTE_CATEGORY
      });
    }
  }

  get_contextmenu_context(): IContext | null {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const event = this.app._contextMenuEvent as MouseEvent;
    const target = event.target as HTMLElement;
    const code_mirror_wrapper: any = target.closest('.CodeMirror');
    if (code_mirror_wrapper === null) {
      return null;
    }
    const code_mirror = code_mirror_wrapper.CodeMirror as CodeMirror.Editor;
    const position = code_mirror.coordsChar({
      left: event.clientX,
      top: event.clientY
    });

    return {
      editor: code_mirror,
      position: position
    };
  }

  /**
   * This is different from token as implemented in CodeMirror
   * and needed because Markdown does not tokenize words
   * (each letter outside of markdown features is a separate token!)
   */
  get_current_word(context: IContext): IWord {
    const { editor, position } = context;
    const line = editor.getDoc().getLine(position.line);
    let start = position.ch;
    while (start > 0 && line[start].match(this.rx_word_char)) {
      start--;
    }
    let end = position.ch;
    while (end < line.length && line[end].match(this.rx_word_char)) {
      end++;
    }
    return {
      line: position.line,
      start: start,
      end: end,
      text: line.substring(start, end)
    };
  }

  setup_suggestions() {
    this.suggestions_menu = new Menu({ commands: this.app.commands });
    this.suggestions_menu.title.label = TEXT_SUGGESTIONS_AVAILABLE;
    this.suggestions_menu.title.icon = spellcheckIcon.bindprops({
      stylesheet: 'menuItem'
    });

    // this command is not meant to be show - it is just menu trigger detection hack
    this.app.commands.addCommand(CommandIDs.updateSuggestions, {
      execute: args => {
        // no-op
      },
      isVisible: args => {
        this.prepare_suggestions();
        return false;
      }
    });
    this.app.contextMenu.addItem({
      selector: '.cm-spell-error',
      command: CommandIDs.updateSuggestions
    });
    // end of the menu trigger detection hack

    this.app.contextMenu.addItem({
      selector: '.cm-spell-error',
      submenu: this.suggestions_menu,
      type: 'submenu'
    });
    this.app.commands.addCommand(CommandIDs.applySuggestion, {
      execute: args => {
        this.apply_suggestion(args['name'] as string);
      },
      label: args => args['name'] as string
    });
  }

  setup_ignore_action() {
    this.app.commands.addCommand(CommandIDs.ignoreWord, {
      execute: () => {
        this.ignore();
      },
      label: 'Ignore'
    });

    this.app.contextMenu.addItem({
      selector: '.cm-spell-error',
      command: CommandIDs.ignoreWord
    });
  }

  ignore() {
    const context = this.get_contextmenu_context();

    if (context === null) {
      console.log(
        'Could not ignore the word as the context was no longer available'
      );
    } else {
      const word = this.get_current_word(context);
      this.settings
        .set('ignore', [
          word.text.trim(),
          ...(this.settings.get('ignore').composite as Array<string>)
        ])
        .catch(console.warn);
    }
  }

  prepare_suggestions() {
    const context = this.get_contextmenu_context();
    let suggestions: string[];
    if (context === null) {
      // no context (e.g. the edit was applied and the token is no longer in DOM,
      // so we cannot find the parent editor
      suggestions = [];
    } else {
      const word = this.get_current_word(context);
      suggestions = this.dictionary.suggest(word.text);
    }
    this.suggestions_menu.clearItems();

    if (suggestions.length) {
      for (const suggestion of suggestions) {
        this.suggestions_menu.addItem({
          command: CommandIDs.applySuggestion,
          args: { name: suggestion }
        });
      }
      this.suggestions_menu.title.label = TEXT_SUGGESTIONS_AVAILABLE;
      this.suggestions_menu.title.className = '';
      this.suggestions_menu.setHidden(false);
    } else {
      this.suggestions_menu.title.className = 'lm-mod-disabled';
      this.suggestions_menu.title.label = TEXT_NO_SUGGESTIONS;
      this.suggestions_menu.setHidden(true);
    }
  }

  apply_suggestion(replacement: string) {
    const context = this.get_contextmenu_context();
    if (context === null) {
      console.warn(
        'Applying suggestion failed (probably was already applied earlier)'
      );
      return;
    }
    const word = this.get_current_word(context);

    context.editor.getDoc().replaceRange(
      replacement,
      {
        ch: word.start,
        line: word.line
      },
      {
        ch: word.end,
        line: word.line
      }
    );
  }

  load_dictionary() {
    this.status_msg = 'Loading dictionary ...';
    this.status_widget.update();
    return Promise.all([
      fetch(this.language.aff).then(res => res.text()),
      fetch(this.language.dic).then(res => res.text())
    ]).then(values => {
      this.dictionary = new Typo(this.language.name, values[0], values[1]);
      console.debug(
        'Dictionary Loaded ',
        this.language.name,
        this.language.code
      );

      this.status_msg = this.language.name;
      // update the complete UI
      this.status_widget.update();
      this.refresh_state();
    });
  }

  define_mode = (original_mode_spec: string) => {
    if (original_mode_spec.indexOf('spellcheck_') === 0) {
      return original_mode_spec;
    }
    const new_mode_spec = 'spellcheck_' + original_mode_spec;
    this.code_mirror.CodeMirror.defineMode(new_mode_spec, (config: any) => {
      const spellchecker_overlay = {
        name: new_mode_spec,
        token: (stream: any, state: any) => {
          if (stream.eatWhile(this.rx_word_char)) {
            const word = stream.current().replace(/(^')|('$)/g, '');
            if (
              word !== '' &&
              !word.match(/^\d+$/) &&
              this.dictionary !== undefined &&
              !this.dictionary.check(word) &&
              !this.ignored_tokens.has(word)
            ) {
              return 'spell-error';
            }
          }
          stream.eatWhile(this.rx_non_word_char);
          return null;
        }
      };
      return this.code_mirror.CodeMirror.overlayMode(
        this.code_mirror.CodeMirror.getMode(config, original_mode_spec),
        spellchecker_overlay,
        true
      );
    });
    return new_mode_spec;
  };

  refresh_state() {
    // update the active cell (if any)
    if (this.tracker.activeCell !== null) {
      this.setup_cell_editor(this.tracker.activeCell);
    }

    // update the current file editor (if any)
    if (this.editor_tracker.currentWidget !== null) {
      this.setup_file_editor(this.editor_tracker.currentWidget.content);
    }
  }

  choose_language() {
    // show the current language first, then all others
    const choices = [
      this.language,
      ...languages.filter(l => l.name !== this.language.name)
    ];

    InputDialog.getItem({
      title: 'Choose spellchecker language',
      items: choices.map(language => language.name)
    }).then(value => {
      if (value.value !== null) {
        this.language = languages.filter(l => l.name === value.value)[0];
        // the setup routine will load the dirctionary
        this.settings.set('language', this.language.code).catch(console.warn);
      }
    });
  }

  setup_language_picker() {
    this.status_widget = new StatusWidget(() => this.status_msg);
    this.status_widget.node.onclick = () => {
      this.choose_language();
    };
    this.app.commands.addCommand(CommandIDs.chooseLanguage, {
      execute: args => this.choose_language(),
      label: 'Choose spellchecker language'
    });

    if (this.palette) {
      this.palette.addItem({
        command: CommandIDs.chooseLanguage,
        category: PALETTE_CATEGORY
      });
    }

    if (this.status_bar) {
      this.status_bar.registerStatusItem('spellchecker:choose-language', {
        align: 'right',
        item: this.status_widget
      });
    }
  }
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
  console.log('Attempting to load Copy Code Plugin');
  const command: string = 'copy:code'
  app.commands.addCommand(command, {
      label: 'CCT',
  execute: () => {
      const sp = new CopyCode(app, tracker, editor_tracker, setting_registry, code_mirror, palette, status_bar);
      console.log("CopyCode: ",sp)
  }});
  palette.addItem({command, category: 'Tutorial'});
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

export default extension;
