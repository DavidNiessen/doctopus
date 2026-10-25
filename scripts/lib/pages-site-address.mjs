/** Resolve the public origin and mount path before compiling any demo assets. */
export function pagesSiteAddress({
  repository = 'DavidNiessen/doctopus',
  customDomain,
  siteUrl,
} = {}) {
  let domain;
  if (customDomain !== undefined) {
    domain = customDomain.trim().toLowerCase();
    if (
      domain.length > 253 ||
      !domain.includes('.') ||
      !domain
        .split('.')
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      throw new Error(
        'The demo CNAME must contain one DNS hostname without a scheme, path or port.',
      );
  }
  const [owner, name] = repository.toLowerCase().split('/');
  const fallback = domain
    ? `https://${domain}/`
    : `https://${owner}.github.io${name === `${owner}.github.io` ? '' : '/' + name}`;
  const address = new URL(siteUrl ?? fallback);
  if (
    address.protocol !== 'https:' ||
    address.username ||
    address.password ||
    address.search ||
    address.hash
  )
    throw new Error(
      'PAGES_SITE_URL must be an HTTPS site URL without credentials, query or fragment.',
    );
  return address;
}
