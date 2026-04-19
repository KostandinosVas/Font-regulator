/**
 * Font Regulator — Sanitizer Unit Tests
 * Run with: node tests/sanitizer.test.js
 *
 * Tests every security-critical validation path in content.js.
 * No dependencies — pure Node.js.
 */

'use strict';

// ---------------------------------------------------------------------------
// Copy of the sanitization logic from content/content.js
// (kept in sync manually — if you change content.js, update here too)
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'span', 'a', 'li', 'blockquote', 'label',
  'td', 'th', 'div', 'article', 'section',
  'strong', 'em', 'b', 'i', 'small', 'code', 'pre'
]);

function sanitizeRule(rule) {
  const safe = {};

  if (rule.fontSize !== undefined) {
    const val = String(rule.fontSize).trim();
    if (/^\d+(\.\d+)?px$/.test(val)) {
      const num = parseFloat(val);
      if (num >= 1 && num <= 200) {
        safe.fontSize = val;
      }
    }
  }

  if (rule.fontFamily !== undefined) {
    const val = String(rule.fontFamily)
      .replace(/[;{}()<>\\]/g, '')
      .trim()
      .slice(0, 200);
    if (val.length > 0) {
      safe.fontFamily = val;
    }
  }

  if (rule.lineHeight !== undefined) {
    const val = String(rule.lineHeight).trim();
    if (/^\d+(\.\d+)?$/.test(val)) {
      const num = parseFloat(val);
      if (num >= 0.5 && num <= 5.0) {
        safe.lineHeight = val;
      }
    }
  }

  if (rule.color !== undefined) {
    const val = String(rule.color).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      safe.color = val;
    }
  }

  return safe;
}

function buildCSS(rules) {
  if (!rules || typeof rules !== 'object') return '';
  const lines = [];
  for (const [tag, rule] of Object.entries(rules)) {
    if (!ALLOWED_TAGS.has(tag)) continue;
    const safe = sanitizeRule(rule);
    const props = [];
    if (safe.fontSize)   props.push(`font-size: ${safe.fontSize} !important`);
    if (safe.fontFamily) props.push(`font-family: ${safe.fontFamily} !important`);
    if (safe.lineHeight) props.push(`line-height: ${safe.lineHeight} !important`);
    if (safe.color)      props.push(`color: ${safe.color} !important`);
    if (props.length > 0) {
      lines.push(`${tag} {\n  ${props.join(';\n  ')};\n}`);
    }
  }
  return lines.join('\n\n');
}

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${description}`);
    passed++;
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m ${description}`);
    console.log(`      \x1b[31m${e.message}\x1b[0m`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b) {
  if (a !== b) throw new Error(`Expected: ${JSON.stringify(b)}\n      Got:      ${JSON.stringify(a)}`);
}

function assertUndefined(val) {
  if (val !== undefined) throw new Error(`Expected undefined, got: ${JSON.stringify(val)}`);
}

function assertNotContains(str, sub) {
  if (str.includes(sub)) throw new Error(`String should NOT contain "${sub}" but does:\n      ${str}`);
}

// ---------------------------------------------------------------------------
// fontSize Tests
// ---------------------------------------------------------------------------

console.log('\n\x1b[1mfontSize — valid values\x1b[0m');

test('integer px accepted', () => {
  assertEqual(sanitizeRule({ fontSize: '16px' }).fontSize, '16px');
});
test('decimal px accepted', () => {
  assertEqual(sanitizeRule({ fontSize: '16.5px' }).fontSize, '16.5px');
});
test('min boundary 1px accepted', () => {
  assertEqual(sanitizeRule({ fontSize: '1px' }).fontSize, '1px');
});
test('max boundary 200px accepted', () => {
  assertEqual(sanitizeRule({ fontSize: '200px' }).fontSize, '200px');
});

console.log('\n\x1b[1mfontSize — rejected values\x1b[0m');

test('0px rejected (below min)', () => {
  assertUndefined(sanitizeRule({ fontSize: '0px' }).fontSize);
});
test('201px rejected (above max)', () => {
  assertUndefined(sanitizeRule({ fontSize: '201px' }).fontSize);
});
test('negative value rejected', () => {
  assertUndefined(sanitizeRule({ fontSize: '-10px' }).fontSize);
});
test('em unit rejected', () => {
  assertUndefined(sanitizeRule({ fontSize: '2em' }).fontSize);
});
test('bare number rejected (no unit)', () => {
  assertUndefined(sanitizeRule({ fontSize: '16' }).fontSize);
});
test('CSS expression rejected', () => {
  assertUndefined(sanitizeRule({ fontSize: 'expression(alert(1))' }).fontSize);
});
test('calc() rejected', () => {
  assertUndefined(sanitizeRule({ fontSize: 'calc(100% - 10px)' }).fontSize);
});
test('vw unit rejected', () => {
  assertUndefined(sanitizeRule({ fontSize: '5vw' }).fontSize);
});
test('XSS payload in fontSize rejected', () => {
  assertUndefined(sanitizeRule({ fontSize: '16px; color: red' }).fontSize);
});

// ---------------------------------------------------------------------------
// fontFamily Tests
// ---------------------------------------------------------------------------

console.log('\n\x1b[1mfontFamily — valid values\x1b[0m');

test('simple name accepted', () => {
  assertEqual(sanitizeRule({ fontFamily: 'Georgia' }).fontFamily, 'Georgia');
});
test('quoted name accepted', () => {
  assertEqual(sanitizeRule({ fontFamily: "'Times New Roman'" }).fontFamily, "'Times New Roman'");
});
test('system stack accepted', () => {
  const val = 'system-ui, -apple-system, sans-serif';
  assertEqual(sanitizeRule({ fontFamily: val }).fontFamily, val);
});

console.log('\n\x1b[1mfontFamily — injection attempts stripped\x1b[0m');

test('semicolons stripped', () => {
  const result = sanitizeRule({ fontFamily: 'Arial; color: red' }).fontFamily;
  assertNotContains(result, ';');
});
test('curly braces stripped', () => {
  const result = sanitizeRule({ fontFamily: 'Arial} p {color:red' }).fontFamily;
  assertNotContains(result, '}');
  assertNotContains(result, '{');
});
test('parentheses stripped (blocks url())', () => {
  const result = sanitizeRule({ fontFamily: 'url(javascript:alert(1))' }).fontFamily;
  assertNotContains(result, '(');
  assertNotContains(result, ')');
});
test('backslash stripped', () => {
  const result = sanitizeRule({ fontFamily: 'Arial\\0041' }).fontFamily;
  assertNotContains(result, '\\');
});
test('angle brackets stripped', () => {
  const result = sanitizeRule({ fontFamily: 'Arial<script>' }).fontFamily;
  assertNotContains(result, '<');
  assertNotContains(result, '>');
});
test('length capped at 200 chars', () => {
  const long = 'A'.repeat(300);
  assert(sanitizeRule({ fontFamily: long }).fontFamily.length <= 200);
});
test('empty string after stripping returns undefined', () => {
  assertUndefined(sanitizeRule({ fontFamily: ';;;{}' }).fontFamily);
});

// ---------------------------------------------------------------------------
// lineHeight Tests
// ---------------------------------------------------------------------------

console.log('\n\x1b[1mlineHeight — valid values\x1b[0m');

test('unitless integer accepted', () => {
  assertEqual(sanitizeRule({ lineHeight: '1' }).lineHeight, '1');
});
test('unitless decimal accepted', () => {
  assertEqual(sanitizeRule({ lineHeight: '1.5' }).lineHeight, '1.5');
});
test('min boundary 0.5 accepted', () => {
  assertEqual(sanitizeRule({ lineHeight: '0.5' }).lineHeight, '0.5');
});
test('max boundary 5.0 accepted', () => {
  assertEqual(sanitizeRule({ lineHeight: '5' }).lineHeight, '5');
});

console.log('\n\x1b[1mlineHeight — rejected values\x1b[0m');

test('px unit rejected', () => {
  assertUndefined(sanitizeRule({ lineHeight: '24px' }).lineHeight);
});
test('0.4 rejected (below min)', () => {
  assertUndefined(sanitizeRule({ lineHeight: '0.4' }).lineHeight);
});
test('5.1 rejected (above max)', () => {
  assertUndefined(sanitizeRule({ lineHeight: '5.1' }).lineHeight);
});
test('negative rejected', () => {
  assertUndefined(sanitizeRule({ lineHeight: '-1' }).lineHeight);
});
test('CSS injection in lineHeight rejected', () => {
  assertUndefined(sanitizeRule({ lineHeight: '1.5; color: red' }).lineHeight);
});
test('normal keyword rejected', () => {
  assertUndefined(sanitizeRule({ lineHeight: 'normal' }).lineHeight);
});

// ---------------------------------------------------------------------------
// color Tests
// ---------------------------------------------------------------------------

console.log('\n\x1b[1mcolor — valid values\x1b[0m');

test('6-digit hex lowercase accepted', () => {
  assertEqual(sanitizeRule({ color: '#ff0000' }).color, '#ff0000');
});
test('6-digit hex uppercase accepted', () => {
  assertEqual(sanitizeRule({ color: '#FF0000' }).color, '#FF0000');
});
test('mixed case hex accepted', () => {
  assertEqual(sanitizeRule({ color: '#aAbBcC' }).color, '#aAbBcC');
});
test('black accepted', () => {
  assertEqual(sanitizeRule({ color: '#000000' }).color, '#000000');
});
test('white accepted', () => {
  assertEqual(sanitizeRule({ color: '#ffffff' }).color, '#ffffff');
});

console.log('\n\x1b[1mcolor — rejected values\x1b[0m');

test('3-digit hex rejected', () => {
  assertUndefined(sanitizeRule({ color: '#fff' }).color);
});
test('named color rejected', () => {
  assertUndefined(sanitizeRule({ color: 'red' }).color);
});
test('rgb() rejected', () => {
  assertUndefined(sanitizeRule({ color: 'rgb(255,0,0)' }).color);
});
test('no leading # rejected', () => {
  assertUndefined(sanitizeRule({ color: 'ff0000' }).color);
});
test('CSS injection in color rejected', () => {
  assertUndefined(sanitizeRule({ color: '#ff0000; background: blue' }).color);
});
test('javascript: in color rejected', () => {
  assertUndefined(sanitizeRule({ color: 'javascript:alert(1)' }).color);
});

// ---------------------------------------------------------------------------
// Tag Allowlist Tests
// ---------------------------------------------------------------------------

console.log('\n\x1b[1mbuildCSS — tag allowlist\x1b[0m');

test('allowed tag p generates CSS', () => {
  const css = buildCSS({ p: { fontSize: '16px' } });
  assert(css.includes('p {'), `CSS should include "p {": ${css}`);
});
test('allowed tag h1 generates CSS', () => {
  const css = buildCSS({ h1: { fontSize: '32px' } });
  assert(css.includes('h1 {'), `CSS should include "h1 {": ${css}`);
});
test('disallowed tag "body" rejected', () => {
  const css = buildCSS({ body: { fontSize: '16px' } });
  assert(css === '', `Expected empty CSS, got: ${css}`);
});
test('disallowed tag "html" rejected', () => {
  const css = buildCSS({ html: { color: '#ff0000' } });
  assert(css === '', `Expected empty CSS, got: ${css}`);
});
test('disallowed tag "*" rejected', () => {
  const css = buildCSS({ '*': { color: '#ff0000' } });
  assert(css === '', `Expected empty CSS, got: ${css}`);
});
test('disallowed tag "script" rejected', () => {
  const css = buildCSS({ script: { color: '#ff0000' } });
  assert(css === '', `Expected empty CSS, got: ${css}`);
});
test('disallowed tag "style" rejected', () => {
  const css = buildCSS({ style: { color: '#ff0000' } });
  assert(css === '', `Expected empty CSS, got: ${css}`);
});
test('disallowed tag "input" rejected', () => {
  const css = buildCSS({ input: { color: '#ff0000' } });
  assert(css === '', `Expected empty CSS, got: ${css}`);
});
test('prototype pollution tag __proto__ rejected', () => {
  const rules = JSON.parse('{"__proto__": {"fontSize": "16px"}}');
  const css = buildCSS(rules);
  assert(css === '', `Expected empty CSS, got: ${css}`);
});

// ---------------------------------------------------------------------------
// buildCSS — Output Safety Tests
// ---------------------------------------------------------------------------

console.log('\n\x1b[1mbuildCSS — output safety\x1b[0m');

test('generated CSS contains no <script> tags', () => {
  const css = buildCSS({
    p: { fontFamily: 'Arial<script>alert(1)</script>', fontSize: '16px' }
  });
  assertNotContains(css, '<script>');
});
test('generated CSS contains no injected CSS blocks from fontFamily', () => {
  const css = buildCSS({ p: { fontFamily: 'Arial} body{color:red' } });
  // Braces are stripped so a rogue CSS block cannot be opened.
  // The word "body" may still appear as text inside the font-family value
  // (browser ignores unknown font names — harmless). What matters is no block.
  assertNotContains(css, 'body {');
  assertNotContains(css, 'body{');
});
test('null rules returns empty string', () => {
  assertEqual(buildCSS(null), '');
});
test('empty rules object returns empty string', () => {
  assertEqual(buildCSS({}), '');
});
test('rule with no valid properties produces no CSS', () => {
  const css = buildCSS({ p: { fontSize: 'bad', color: 'blue', lineHeight: '99' } });
  assertEqual(css, '');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(50)}`);
const total = passed + failed;
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1m✓ All ${total} tests passed.\x1b[0m\n`);
  process.exit(0);
} else {
  console.log(`\x1b[31m\x1b[1m✗ ${failed} of ${total} tests failed.\x1b[0m\n`);
  process.exit(1);
}
