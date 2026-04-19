/**
 * Font Regulator — Popup Script
 * Handles all UI interactions, storage reads/writes,
 * and communication with the content script.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'span', 'a', 'li', 'blockquote', 'label',
  'td', 'th', 'div', 'article', 'section',
  'strong', 'em', 'b', 'i', 'small', 'code', 'pre'
];

// Default slider values (used when "not set")
const DEFAULTS = {
  fontSize:   16,
  lineHeight: 1.5,
  color:      '#000000'
};

// Debounce delay in ms before saving + pushing changes
const DEBOUNCE_MS = 150;

// ---------------------------------------------------------------------------
// Runtime State
// ---------------------------------------------------------------------------

let currentDomain = '';
let currentTag    = 'p';
let siteData      = { enabled: true, rules: {} }; // loaded from storage
let presentTags   = new Set();                      // tags found on the page
let activeTabId   = null;

// Debounce timer handle
let debounceTimer = null;

// Per-property "active" flags.
// Font size and line height sliders always have a numeric value, so we need
// explicit flags to distinguish "user set this" from "slider is just at default".
// Mirrors the colorIsSet pattern used for the color picker.
let colorIsSet      = false;
let fontSizeActive  = false;
let lineHeightActive = false;

// ---------------------------------------------------------------------------
// Validators (mirrors content script, for safe UI values)
// ---------------------------------------------------------------------------

function isValidHex(val) {
  return /^#[0-9a-fA-F]{6}$/.test(val);
}

function sanitizeFontFamily(val) {
  return String(val).replace(/[;{}()<>\\]/g, '').trim().slice(0, 200);
}

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);

const siteBadge       = $('siteBadge');
const enabledToggle   = $('enabledToggle');
const disabledOverlay = $('disabledOverlay');
const mainContent     = $('mainContent');

const fontSizeSlider  = $('fontSizeSlider');
const fontSizeInput   = $('fontSizeInput');
const fontSizeHint    = $('fontSizeHint');

const fontFamilySelect = $('fontFamilySelect');

const lineHeightSlider = $('lineHeightSlider');
const lineHeightInput  = $('lineHeightInput');
const lineHeightHint   = $('lineHeightHint');

const colorPicker      = $('colorPicker');
const colorHex         = $('colorHex');
const clearColorBtn    = $('clearColorBtn');

const previewBox       = $('previewBox');

const resetElementBtn  = $('resetElementBtn');
const resetAllBtn      = $('resetAllBtn');

const confirmDialog    = $('confirmDialog');
const dialogDomain     = $('dialogDomain');
const cancelResetBtn   = $('cancelResetBtn');
const confirmResetBtn  = $('confirmResetBtn');

const tagTabs = Array.from(document.querySelectorAll('.tag-tab'));

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------

function loadSiteData(domain) {
  return new Promise(resolve => {
    chrome.storage.local.get('sites', data => {
      const sites = (data && data.sites) || {};
      resolve(sites[domain] || { enabled: true, rules: {} });
    });
  });
}

function saveSiteData(domain, data) {
  return new Promise(resolve => {
    chrome.storage.local.get('sites', stored => {
      const sites = (stored && stored.sites) || {};
      sites[domain] = data;
      chrome.storage.local.set({ sites }, resolve);
    });
  });
}

// ---------------------------------------------------------------------------
// Content Script Messaging
// ---------------------------------------------------------------------------

async function sendToContentScript(message) {
  if (!activeTabId) return;
  try {
    await chrome.tabs.sendMessage(activeTabId, message);
  } catch {
    // Content script missing (tab was open before install/reload) — inject and retry.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content/content.js']
      });
      await chrome.tabs.sendMessage(activeTabId, message);
    } catch {
      // Restricted page (chrome://, file://) — silently ignore.
    }
  }
}

async function getPageInfo() {
  if (!activeTabId) return { presentTags: [], domain: '' };
  try {
    return await chrome.tabs.sendMessage(activeTabId, { type: 'getPageInfo' });
  } catch {
    // Content script missing — inject and retry once.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content/content.js']
      });
      return await chrome.tabs.sendMessage(activeTabId, { type: 'getPageInfo' });
    } catch {
      return { presentTags: [], domain: '' };
    }
  }
}

// ---------------------------------------------------------------------------
// UI: Tab Rendering
// ---------------------------------------------------------------------------

function renderTabs() {
  tagTabs.forEach(tab => {
    const tag = tab.dataset.tag;

    // Active state
    if (tag === currentTag) {
      tab.setAttribute('aria-selected', 'true');
      tab.tabIndex = 0;
    } else {
      tab.setAttribute('aria-selected', 'false');
      tab.tabIndex = -1;
    }

    // Present-on-page indicator
    if (presentTags.size > 0) {
      if (presentTags.has(tag)) {
        tab.classList.remove('absent');
      } else {
        tab.classList.add('absent');
      }
    } else {
      tab.classList.remove('absent');
    }

    // Has-rule dot
    const rule = (siteData.rules || {})[tag];
    const hasAnyValue = rule && Object.keys(rule).some(k => rule[k] !== undefined && rule[k] !== '');
    if (hasAnyValue) {
      tab.classList.add('has-rule');
    } else {
      tab.classList.remove('has-rule');
    }
  });
}

// ---------------------------------------------------------------------------
// UI: Controls Population
// ---------------------------------------------------------------------------

function populateControls(tag) {
  const rule = (siteData.rules || {})[tag] || {};

  // Font Size — only "active" if the stored rule has an explicit value
  fontSizeActive = !!rule.fontSize;
  const fs = rule.fontSize ? parseFloat(rule.fontSize) : DEFAULTS.fontSize;
  fontSizeSlider.value = Math.min(72, Math.max(8, fs));
  fontSizeInput.value  = fs;
  fontSizeHint.textContent = rule.fontSize ? rule.fontSize : '—';

  // Font Family
  const ff = rule.fontFamily || '';
  // Try to match one of the <option> values
  let matched = false;
  for (const opt of fontFamilySelect.options) {
    if (opt.value === ff) {
      fontFamilySelect.value = ff;
      matched = true;
      break;
    }
  }
  if (!matched) fontFamilySelect.value = '';

  // Line Height — only "active" if the stored rule has an explicit value
  lineHeightActive = !!rule.lineHeight;
  const lh = rule.lineHeight ? parseFloat(rule.lineHeight) : DEFAULTS.lineHeight;
  lineHeightSlider.value = Math.min(3, Math.max(0.5, lh));
  lineHeightInput.value  = lh;
  lineHeightHint.textContent = rule.lineHeight ? rule.lineHeight : '—';

  // Color
  if (rule.color && isValidHex(rule.color)) {
    colorPicker.value = rule.color;
    colorHex.value    = rule.color;
    colorIsSet        = true;
    colorHex.classList.remove('invalid');
  } else {
    colorPicker.value = '#000000';
    colorHex.value    = '';
    colorIsSet        = false;
  }

  // Update preview
  updatePreview();
}

// ---------------------------------------------------------------------------
// UI: Preview Box
// ---------------------------------------------------------------------------

function updatePreview() {
  const rule = buildCurrentRule();

  previewBox.style.fontSize   = rule.fontSize   || '';
  previewBox.style.fontFamily = rule.fontFamily  || '';
  previewBox.style.lineHeight = rule.lineHeight  || '';
  previewBox.style.color      = (colorIsSet && rule.color) ? rule.color : '';
}

// ---------------------------------------------------------------------------
// Rule Building from UI
// ---------------------------------------------------------------------------

function buildCurrentRule() {
  const rule = {};

  // Font size — only include if the user has explicitly set it
  if (fontSizeActive) {
    const fsVal = parseFloat(fontSizeInput.value);
    if (!isNaN(fsVal) && fsVal >= 1 && fsVal <= 200) {
      rule.fontSize = `${fsVal}px`;
    }
  }

  // Font family — "not set" option has value "", so this naturally stays unset
  const ffVal = sanitizeFontFamily(fontFamilySelect.value);
  if (ffVal) {
    rule.fontFamily = ffVal;
  }

  // Line height — only include if the user has explicitly set it
  if (lineHeightActive) {
    const lhVal = parseFloat(lineHeightInput.value);
    if (!isNaN(lhVal) && lhVal >= 0.5 && lhVal <= 5.0) {
      rule.lineHeight = String(Math.round(lhVal * 10) / 10);
    }
  }

  // Color
  if (colorIsSet && isValidHex(colorHex.value)) {
    rule.color = colorHex.value;
  }

  return rule;
}

// ---------------------------------------------------------------------------
// Save + Push (debounced)
// ---------------------------------------------------------------------------

function scheduleUpdate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(commitUpdate, DEBOUNCE_MS);
}

async function commitUpdate() {
  const rule = buildCurrentRule();

  siteData.rules = siteData.rules || {};

  if (Object.keys(rule).length > 0) {
    siteData.rules[currentTag] = rule;
  } else {
    // No properties active — remove the entry to keep storage clean
    delete siteData.rules[currentTag];
  }

  await saveSiteData(currentDomain, siteData);

  // Push to content script
  if (siteData.enabled !== false) {
    await sendToContentScript({ type: 'applyRules', rules: siteData.rules });
  }

  // Update tab dots
  renderTabs();
  updatePreview();
}

// ---------------------------------------------------------------------------
// Event Listeners: Controls
// ---------------------------------------------------------------------------

// Font Size — slider drives number input
fontSizeSlider.addEventListener('input', () => {
  fontSizeActive = true;
  fontSizeInput.value = fontSizeSlider.value;
  fontSizeHint.textContent = `${fontSizeSlider.value}px`;
  scheduleUpdate();
});

fontSizeInput.addEventListener('input', () => {
  const val = parseFloat(fontSizeInput.value);
  if (!isNaN(val)) {
    fontSizeActive = true;
    fontSizeSlider.value = Math.min(72, Math.max(8, val));
    fontSizeHint.textContent = `${val}px`;
    scheduleUpdate();
  }
});

// Font Family
fontFamilySelect.addEventListener('change', () => {
  scheduleUpdate();
});

// Line Height — slider drives number input
lineHeightSlider.addEventListener('input', () => {
  lineHeightActive = true;
  const val = Math.round(parseFloat(lineHeightSlider.value) * 10) / 10;
  lineHeightInput.value = val;
  lineHeightHint.textContent = val;
  scheduleUpdate();
});

lineHeightInput.addEventListener('input', () => {
  const val = parseFloat(lineHeightInput.value);
  if (!isNaN(val)) {
    lineHeightActive = true;
    lineHeightSlider.value = Math.min(3, Math.max(0.5, val));
    lineHeightHint.textContent = val;
    scheduleUpdate();
  }
});

// Color Picker → hex field
colorPicker.addEventListener('input', () => {
  colorHex.value = colorPicker.value;
  colorHex.classList.remove('invalid');
  colorIsSet = true;
  scheduleUpdate();
});

// Hex Text Input → color picker
colorHex.addEventListener('input', () => {
  const val = colorHex.value.trim();
  if (isValidHex(val)) {
    colorPicker.value = val;
    colorHex.classList.remove('invalid');
    colorIsSet = true;
    scheduleUpdate();
  } else if (val === '') {
    colorIsSet = false;
    colorHex.classList.remove('invalid');
    scheduleUpdate();
  } else {
    colorHex.classList.add('invalid');
    // Don't push invalid value
  }
});

// Clear Color
clearColorBtn.addEventListener('click', () => {
  colorPicker.value = '#000000';
  colorHex.value    = '';
  colorHex.classList.remove('invalid');
  colorIsSet        = false;
  scheduleUpdate();
});

// ---------------------------------------------------------------------------
// Event Listeners: Element Tabs
// ---------------------------------------------------------------------------

tagTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    currentTag = tab.dataset.tag;
    renderTabs();
    populateControls(currentTag);
  });

  // Keyboard: left/right arrow navigation between tabs
  tab.addEventListener('keydown', (e) => {
    const idx = tagTabs.indexOf(tab);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = tagTabs[(idx + 1) % tagTabs.length];
      next.focus();
      next.click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = tagTabs[(idx - 1 + tagTabs.length) % tagTabs.length];
      prev.focus();
      prev.click();
    }
  });
});

// ---------------------------------------------------------------------------
// Event Listeners: Enabled Toggle
// ---------------------------------------------------------------------------

enabledToggle.addEventListener('change', async () => {
  siteData.enabled = enabledToggle.checked;

  if (siteData.enabled) {
    disabledOverlay.hidden = true;
    mainContent.hidden     = false;
    await sendToContentScript({ type: 'applyRules', rules: siteData.rules || {} });
  } else {
    mainContent.hidden     = true;
    disabledOverlay.hidden = false;
    await sendToContentScript({ type: 'clearRules' });
  }

  await saveSiteData(currentDomain, siteData);
});

// ---------------------------------------------------------------------------
// Event Listeners: Reset Actions
// ---------------------------------------------------------------------------

resetElementBtn.addEventListener('click', async () => {
  if (!siteData.rules) siteData.rules = {};
  delete siteData.rules[currentTag];

  await saveSiteData(currentDomain, siteData);
  await sendToContentScript({ type: 'applyRules', rules: siteData.rules });

  populateControls(currentTag);
  renderTabs();
});

resetAllBtn.addEventListener('click', () => {
  dialogDomain.textContent = currentDomain;
  confirmDialog.hidden = false;
  confirmResetBtn.focus();
});

cancelResetBtn.addEventListener('click', () => {
  confirmDialog.hidden = true;
  resetAllBtn.focus();
});

confirmResetBtn.addEventListener('click', async () => {
  siteData.rules = {};
  await saveSiteData(currentDomain, siteData);
  await sendToContentScript({ type: 'clearRules' });

  confirmDialog.hidden = true;
  populateControls(currentTag);
  renderTabs();
});

// Close dialog on backdrop click
confirmDialog.addEventListener('click', (e) => {
  if (e.target === confirmDialog) {
    confirmDialog.hidden = true;
  }
});

// Close dialog on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !confirmDialog.hidden) {
    confirmDialog.hidden = true;
  }
});

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

async function init() {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  activeTabId = tab.id;

  // Extract domain
  try {
    const url = new URL(tab.url);
    currentDomain = url.hostname;
  } catch {
    currentDomain = '';
  }

  siteBadge.textContent = currentDomain || 'unknown site';
  siteBadge.title       = currentDomain || '';

  // If we're on a chrome:// or edge:// page, disable the UI
  if (!currentDomain || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    enabledToggle.disabled = true;
    siteBadge.textContent  = 'Not available here';
    mainContent.hidden     = true;
    disabledOverlay.hidden = false;
    disabledOverlay.querySelector('p').textContent = 'Font Regulator cannot run on browser pages.';
    return;
  }

  // Load persisted settings
  siteData = await loadSiteData(currentDomain);

  // Sync enabled toggle
  enabledToggle.checked = siteData.enabled !== false;

  if (!enabledToggle.checked) {
    mainContent.hidden     = true;
    disabledOverlay.hidden = false;
  }

  // Get which tags are present on the page
  const info = await getPageInfo();
  if (info && info.presentTags) {
    presentTags = new Set(info.presentTags);
  }

  // Default selected tab to first present tag among our tabs, or 'p'
  const firstPresent = tagTabs.find(t => presentTags.has(t.dataset.tag));
  if (firstPresent) {
    currentTag = firstPresent.dataset.tag;
  }

  renderTabs();
  populateControls(currentTag);
}

init();
