import { feedbackHref } from '@davidniessen/doctopus-contracts';
import type { ProjectConfig } from '@davidniessen/doctopus-contracts';
import { useUi } from '../ui-translation.js';
import { Icon } from './Icon.js';

export function PageFooter({
  source,
  config,
  path,
}: {
  source: string;
  config: ProjectConfig;
  path: string;
}) {
  const t = useUi();
  const feedback = feedbackHref(config, path);
  return (
    <footer className="article-footer">
      <div>
        <Icon name="code" size={15} />
        <span>
          {t('footer.source')} <code>{source}</code>
        </span>
      </div>
      {feedback && (
        <a
          className="article-feedback"
          href={feedback}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          {config.feedback?.label ?? t('footer.feedback')}
          <Icon name="arrow" size={13} />
          <span className="sr-only">{t('footer.newTab')}</span>
        </a>
      )}
      <span>{t('footer.builtWith')}</span>
    </footer>
  );
}
