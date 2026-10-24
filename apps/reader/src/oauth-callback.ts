const parameters = new URLSearchParams(location.search);
export {};
history.replaceState(null, '', location.pathname);
const output = document.getElementById('oauth-result');
try {
  if (!window.opener) throw new Error('No authorization window');
  const query = new URLSearchParams();
  for (const name of ['code', 'state', 'iss', 'error']) {
    const values = parameters.getAll(name);
    if (values.length > 1) throw new Error('Duplicate callback parameter');
    if (values.length) query.set(name, values[0]!);
  }
  window.opener.postMessage(
    { type: 'doctopus:oauth-callback', query: query.toString() },
    location.origin,
  );
  if (output)
    output.textContent = 'Authorization received. You can close this window.';
  window.close();
} catch {
  if (output)
    output.textContent =
      'Authorization could not reach the documentation window. Return to the documentation and try again.';
}
