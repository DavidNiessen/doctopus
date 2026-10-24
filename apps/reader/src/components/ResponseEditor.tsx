import { useContext, useEffect, useRef, useState } from 'react';
import { EditorThemeContext } from '../use-reader-preferences.js';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/codicon.css';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { responseEditorTheme } from '../response-editor-theme.js';
import { responseDisplay, responseLanguage } from '../response-view.js';
import { useUi } from '../ui-translation.js';
import { Icon } from './Icon.js';
import { CopyButton } from './CopyButton.js';

// Only the standalone editor and selected tokenizers are loaded, without language services.
globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker() };
monaco.languages.register({
  id: 'json',
  aliases: ['JSON', 'json'],
  mimetypes: ['application/json'],
});
monaco.languages.setLanguageConfiguration('json', {
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
});
monaco.languages.setMonarchTokensProvider('json', {
  defaultToken: '',
  tokenPostfix: '.json',
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'string.key'],
      [/"(?:[^"\\]|\\.)*"/, 'string.value'],
      [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/[{}[\]]/, '@brackets'],
      [/[:,]/, 'delimiter'],
    ],
  },
});

export default function ResponseEditor({
  body,
  contentType,
}: {
  body: string;
  contentType: string;
}) {
  const t = useUi();
  const { palette, accent, mode } = useContext(EditorThemeContext);
  const selectedTheme = useRef({ palette, accent, mode });
  selectedTheme.current = { palette, accent, mode };
  useEffect(() => {
    monaco.editor.defineTheme(
      'doctopus-response',
      responseEditorTheme(palette, accent, mode),
    );
    monaco.editor.setTheme('doctopus-response');
  }, [palette, accent, mode]);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenDialog = useRef<HTMLDialogElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const wasFullscreen = useRef(false);
  const viewState = useRef<monaco.editor.ICodeEditorViewState | null>(null);
  const previousBody = useRef(body);
  useEffect(() => {
    const element = fullscreenDialog.current;
    if (fullscreen && element) {
      element.showModal();
      fullscreenButton.current?.focus({ preventScroll: true });
    } else if (wasFullscreen.current) {
      fullscreenButton.current?.focus({ preventScroll: true });
    }
    wasFullscreen.current = fullscreen;
    return () => {
      if (element?.open) element.close();
    };
  }, [fullscreen]);
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [error, setError] = useState('');
  const language = responseLanguage(contentType);
  useEffect(() => {
    if (!host.current) return;
    let editor: monaco.editor.IStandaloneCodeEditor | undefined;
    let model: monaco.editor.ITextModel | undefined;
    try {
      model = monaco.editor.createModel(
        responseDisplay(body, language),
        language,
      );
      const selected = selectedTheme.current;
      monaco.editor.defineTheme(
        'doctopus-response',
        responseEditorTheme(selected.palette, selected.accent, selected.mode),
      );
      editor = monaco.editor.create(host.current, {
        model,
        theme: 'doctopus-response',
        readOnly: true,
        domReadOnly: true,
        ariaLabel: t('response.body'),
        accessibilitySupport: 'on',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 23,
        padding: { top: 14, bottom: 14 },
        folding: true,
        foldingStrategy: 'indentation',
        showFoldingControls: 'always',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        renderLineHighlight: 'none',
        contextmenu: false,
        links: false,
        colorDecorators: false,
        stickyScroll: { enabled: false },
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          useShadows: false,
          alwaysConsumeMouseWheel: false,
        },
        tabIndex: 0,
      });
      if (previousBody.current === body && viewState.current)
        editor.restoreViewState(viewState.current);
      previousBody.current = body;
      instance.current = editor;
    } catch {
      setError(t('response.unavailable'));
    }
    return () => {
      viewState.current = editor?.saveViewState() ?? null;
      instance.current = null;
      editor?.dispose();
      model?.dispose();
    };
  }, [body, language, t, fullscreen]);
  const content = (
    <>
      <div className="response-editor-toolbar">
        <span>
          {t('response.body')}{' '}
          <small>
            {language === 'plaintext' ? 'Text' : language.toUpperCase()}
          </small>
        </span>
        <button
          type="button"
          onClick={() =>
            void instance.current?.getAction('editor.foldAll')?.run()
          }
        >
          {t('response.collapse')}
        </button>
        <button
          type="button"
          onClick={() =>
            void instance.current?.getAction('editor.unfoldAll')?.run()
          }
        >
          {t('response.expand')}
        </button>
        <button
          ref={fullscreenButton}
          type="button"
          className="response-fullscreen-toggle"
          aria-label={t(
            fullscreen ? 'response.exitFullscreen' : 'response.fullscreen',
          )}
          title={t(
            fullscreen ? 'response.exitFullscreen' : 'response.fullscreen',
          )}
          onClick={() => setFullscreen(!fullscreen)}
        >
          <Icon name={fullscreen ? 'minimize' : 'maximize'} size={16} />
        </button>
        <CopyButton text={body} label={t('response.copy')} />
      </div>
      {error && <p role="status">{error}</p>}
      <div
        ref={host}
        className="response-monaco"
        data-editor-theme={mode}
        hidden={!!error}
      />
      {error && (
        <pre tabIndex={0} className="response-fallback">
          {body}
        </pre>
      )}
    </>
  );
  return (
    <>
      <div className="response-editor" hidden={fullscreen}>
        {!fullscreen && content}
      </div>
      <dialog
        ref={fullscreenDialog}
        className="response-fullscreen-dialog"
        aria-label={t('response.body')}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setFullscreen(false);
        }}
      >
        {fullscreen && content}
      </dialog>
    </>
  );
}
