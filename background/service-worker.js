/**
 * Font Regulator — Service Worker (MV3)
 *
 * Responsibilities:
 * - Re-inject content script on tab navigation (when content scripts might
 *   not have fired, e.g. the extension was installed after the page loaded).
 * - Forward "applyRules" messages from popup to the active content script
 *   when the content script is not yet listening.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FontRegulator] Extension installed / updated.');
});
