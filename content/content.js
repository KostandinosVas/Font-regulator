/**
 * Font Regulator — Content Script
 *
 * Runs on every page. Reads domain rules from chrome.storage.local,
 * generates safe CSS, and injects it via a dedicated <style> element.
 * Listens for messages from the popup for live updates.
 */

(function () {
  'use strict';

  // Guard against being injected more than once into the same page
  // (can happen when the popup programmatically re-injects after install/reload).
  if (window.__fontRegulatorLoaded) return;
  window.__fontRegulatorLoaded = true;

  const STYLE_ID = 'font-regulator-injected-styles';

  // ---------------------------------------------------------------------------
  // Allowlists & Validators
  // ---------------------------------------------------------------------------

  const ALLOWED_TAGS = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'a', 'li', 'blockquote', 'label',
    'td', 'th', 'div', 'article', 'section',
    'strong', 'em', 'b', 'i', 'small', 'code', 'pre'
  ]);

  /**
   * Validate and sanitize a single style rule object.
   * Returns a new object with only valid, safe values.
   */
  function sanitizeRule(rule) {
    const safe = {};

    // fontSize: must be digits + optional decimal + "px", within 1–200
    if (rule.fontSize !== undefined) {
      const val = String(rule.fontSize).trim();
      if (/^\d+(\.\d+)?px$/.test(val)) {
        const num = parseFloat(val);
        if (num >= 1 && num <= 200) {
          safe.fontSize = val;
        }
      }
    }

    // fontFamily: strip dangerous characters, limit length
    if (rule.fontFamily !== undefined) {
      const val = String(rule.fontFamily)
        .replace(/[;{}()<>\\]/g, '')
        .trim()
        .slice(0, 200);
      if (val.length > 0) {
        safe.fontFamily = val;
      }
    }

    // lineHeight: unitless number between 0.5 and 5.0
    if (rule.lineHeight !== undefined) {
      const val = String(rule.lineHeight).trim();
      if (/^\d+(\.\d+)?$/.test(val)) {
        const num = parseFloat(val);
        if (num >= 0.5 && num <= 5.0) {
          safe.lineHeight = val;
        }
      }
    }

    // color: must be a 6-digit hex color
    if (rule.color !== undefined) {
      const val = String(rule.color).trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        safe.color = val;
      }
    }

    return safe;
  }

  // ---------------------------------------------------------------------------
  // CSS Generation
  // ---------------------------------------------------------------------------

  /**
   * Generates a CSS string from a rules object.
   * rules: { tagName: { fontSize, fontFamily, lineHeight, color } }
   */
  function buildCSS(rules) {
    if (!rules || typeof rules !== 'object') return '';

    const lines = [];

    for (const [tag, rule] of Object.entries(rules)) {
      // Skip tags not in whitelist
      if (!ALLOWED_TAGS.has(tag)) continue;

      const safe = sanitizeRule(rule);
      const props = [];

      if (safe.fontSize)    props.push(`font-size: ${safe.fontSize} !important`);
      if (safe.fontFamily)  props.push(`font-family: ${safe.fontFamily} !important`);
      if (safe.lineHeight)  props.push(`line-height: ${safe.lineHeight} !important`);
      if (safe.color)       props.push(`color: ${safe.color} !important`);

      if (props.length > 0) {
        lines.push(`${tag} {\n  ${props.join(';\n  ')};\n}`);
      }
    }

    return lines.join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Style Injection
  // ---------------------------------------------------------------------------

  function getOrCreateStyleElement() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      el.setAttribute('data-font-regulator', 'true');
      (document.head || document.documentElement).appendChild(el);
    }
    return el;
  }

  function applyRules(rules) {
    const css = buildCSS(rules);
    const el = getOrCreateStyleElement();
    el.textContent = css;
  }

  function clearRules() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.textContent = '';
  }

  // ---------------------------------------------------------------------------
  // Detect which tag types are actually present on the page
  // ---------------------------------------------------------------------------

  function getPageElementTypes() {
    const present = [];
    for (const tag of ALLOWED_TAGS) {
      if (document.querySelector(tag)) {
        present.push(tag);
      }
    }
    return present;
  }

  // ---------------------------------------------------------------------------
  // Initial Load: Apply stored rules for this domain
  // ---------------------------------------------------------------------------

  function getDomain() {
    try {
      return window.location.hostname;
    } catch {
      return '';
    }
  }

  function init() {
    const domain = getDomain();
    if (!domain) return;

    chrome.storage.local.get('sites', (data) => {
      if (chrome.runtime.lastError) return;
      const sites = data.sites || {};
      const siteData = sites[domain];
      if (siteData && siteData.enabled !== false && siteData.rules) {
        applyRules(siteData.rules);
      }
    });
  }

  init();

  // ---------------------------------------------------------------------------
  // Message Listener (from popup)
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;

    switch (message.type) {
      case 'applyRules': {
        applyRules(message.rules || {});
        sendResponse({ ok: true });
        break;
      }

      case 'clearRules': {
        clearRules();
        sendResponse({ ok: true });
        break;
      }

      case 'getPageInfo': {
        sendResponse({
          ok: true,
          presentTags: getPageElementTypes(),
          domain: getDomain()
        });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }

    return false; // synchronous response
  });

  // ---------------------------------------------------------------------------
  // Storage change listener — keeps styles in sync if user edits in another tab
  // ---------------------------------------------------------------------------

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.sites) return;

    const domain = getDomain();
    if (!domain) return;

    const sites = changes.sites.newValue || {};
    const siteData = sites[domain];

    if (!siteData) {
      clearRules();
      return;
    }

    if (siteData.enabled === false) {
      clearRules();
    } else {
      applyRules(siteData.rules || {});
    }
  });
})();
