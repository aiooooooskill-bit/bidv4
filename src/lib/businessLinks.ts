/** Keep this plugin's authenticated document links in the browser's native
 * navigation path. The host's embedded browser rejects its own application
 * origin, so these links cannot use the ordinary chat external-link handler.
 */
export function startBusinessLinks(): () => void {
  const navigate = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    let url: URL;
    try { url = new URL(anchor.href); } catch { return; }
    if (url.origin !== window.location.origin) return;
    if (!/^\/api\/bidv4\/artifacts\/[^/]+\/file$/.test(url.pathname) && !['/api/bidv4/workbench/content','/api/bidv4/workbench/raw'].includes(url.pathname)) return;
    // Leave the native anchor default intact, including target and downloads.
    event.stopPropagation();
  };
  document.addEventListener('click', navigate, true);
  return () => document.removeEventListener('click', navigate, true);
}
