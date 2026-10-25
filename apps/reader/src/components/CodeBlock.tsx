import { useState } from 'react';
import { Icon } from './Icon.js';
import { useUi } from '../ui-translation.js';
import { codeTokens } from '../code-tokens.js';
export function CodeBlock({
  code,
  title,
  language = 'json',
  toolbar = true,
}: {
  code: string;
  title?: string;
  language?: string;
  toolbar?: boolean;
}) {
  const t = useUi();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="code-block">
      {toolbar && (
        <div className="code-toolbar">
          <span>
            <Icon name="terminal" size={14} />
            {title ?? language}
          </span>
          <button
            type="button"
            aria-label={t('code.copyLabel')}
            onClick={async () => {
              setError(false);
              try {
                await navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                setError(true);
              }
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={15} />
            {t(copied ? 'copy.success' : 'code.copy')}
          </button>
        </div>
      )}
      <pre tabIndex={0}>
        <code>
          {codeTokens(code, language).map((token, index) =>
            token.kind ? (
              <span className={`code-token-${token.kind}`} key={index}>
                {token.text}
              </span>
            ) : (
              token.text
            ),
          )}
        </code>
      </pre>
      {error && <span role="status">{t('code.copyUnavailable')}</span>}
    </div>
  );
}
