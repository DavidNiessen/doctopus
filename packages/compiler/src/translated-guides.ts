import { confinedPath } from '@davidniessen/doctopus-spec';
import { loadGuides } from '@davidniessen/doctopus-content';
import type { GuideReadBudget } from '@davidniessen/doctopus-content';
import { validateGuideTranslations } from '@davidniessen/doctopus-contracts';
import type { SiteData } from '@davidniessen/doctopus-contracts';
export async function loadTranslatedGuides(
  root: string,
  site: SiteData,
  trustContent: boolean,
  budget: GuideReadBudget,
): Promise<void> {
  const roots = Object.entries(site.config.i18n?.guides ?? {});
  if (!roots.length) return;
  const translations: NonNullable<SiteData['guideTranslations']> = {};
  for (const [locale, directory] of roots) {
    await confinedPath(root, directory);
    translations[locale] = await loadGuides(root, directory, {
      trustContent,
      basePath: site.config.basePath,
      localePrefix: '/' + locale,
      budget,
    });
  }
  site.guideTranslations = translations;
  validateGuideTranslations(site);
}
