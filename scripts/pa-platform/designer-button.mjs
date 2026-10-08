// End-to-end check of the in-designer "Edit JSON" button against a mocked
// make.powerautomate.com page (no real tenant).
// Usage: xvfb-run -a node scripts/pa-platform/designer-button.mjs <repoDir> <outDir>
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const repo = path.resolve(process.argv[2] || '.');
const out = path.resolve(process.argv[3] || 'shots');
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright-core');

fs.mkdirSync(out, { recursive: true });
const EXT = path.join(repo, 'build');
const ENV_ID = 'Default-6e2f407e-6cb2-e570-8bce-2be05952c2f6';
const FLOW_ID = '11111111-1111-1111-1111-111111111111';
const WF_ID = '22222222-2222-2222-2222-222222222222';
const MAKER = 'https://make.powerautomate.com';
const API = 'https://unitedstates.api.flow.microsoft.com';
const DV = 'https://contoso.crm.dynamics.com';

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (aud) => `Bearer ${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 3600, aud })}.sig`;
const FLOW_TOKEN = token('https://service.flow.microsoft.com/');
const DV_TOKEN = token(DV);

const flowResponse = {
  name: FLOW_ID,
  id: `/providers/Microsoft.ProcessSimple/environments/${ENV_ID}/flows/${FLOW_ID}`,
  properties: {
    displayName: 'Invoice Approval - Finance',
    state: 'Started',
    workflowEntityId: WF_ID,
    definition: {
      $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
      contentVersion: '1.0.0.0',
      triggers: { manual: { type: 'Request', kind: 'Button', inputs: {} } },
      actions: { Compose: { type: 'Compose', runAfter: {}, inputs: 'hello' } },
    },
    connectionReferences: {},
  },
};

// A tiny SPA standing in for the maker portal: a header toolbar (must be
// ignored), a designer command bar on flow URLs and a list command bar on the
// flows list. navigateTo() mimics client-side routing via history.pushState.
const makerHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Power Automate</title>
<style>
  body { margin: 0; font: 14px "Segoe UI", system-ui, sans-serif; color: #242424; background: #faf9f8; }
  header[role=toolbar] { height: 48px; background: #0f6cbd; color: #fff; display: flex; align-items: center; gap: 8px; padding: 0 16px; }
  header button { background: none; border: 0; color: inherit; font: inherit; }
  .cmd { display: flex; align-items: stretch; height: 44px; background: #fff; border-bottom: 1px solid #e1dfdd; padding: 0 8px; color: #242424; }
  .ms-OverflowSet { display: flex; align-items: stretch; }
  .ms-OverflowSet-item { display: flex; }
  .cmd button { background: none; border: 0; padding: 0 10px; font: inherit; color: inherit; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .cmd button:hover { background: #f3f2f1; }
  .canvas { height: 420px; display: grid; place-items: center; color: #605e5c;
    background-image: radial-gradient(#c8c6c4 1px, transparent 1px); background-size: 16px 16px; }
  .card { background: #fff; border: 1px solid #e1dfdd; border-radius: 6px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
</style></head>
<body><header role="toolbar" aria-label="Portal header"><b>Power Automate</b><button>Settings</button><button>Help</button></header><main id="app"></main>
<script>
  const ENV_ID = ${JSON.stringify(ENV_ID)};
  function render() {
    const app = document.getElementById('app');
    const p = location.pathname;
    if (/\\/flows\\/[0-9a-f-]{36}/i.test(p) && location.search.includes('bare')) {
      app.innerHTML = '<div class="canvas"><div class="card">Designer without a recognisable command bar</div></div>';
    } else if (/\\/flows\\/[0-9a-f-]{36}/i.test(p)) {
      app.innerHTML = '<div role="toolbar" aria-label="Designer commands" class="cmd"><div class="ms-OverflowSet">' +
        ['Back', 'Undo', 'Redo', 'Save draft', 'Publish', 'Flow checker', 'Test'].map((l) =>
          '<div class="ms-OverflowSet-item"><button data-automation-id="' + l.toLowerCase().replace(/ /g, '-') + '-button">' + l + '</button></div>').join('') +
        '</div></div><div class="canvas"><div class="card">Manually trigger a flow</div></div>';
    } else if (/\\/flows\\/?$/.test(p)) {
      app.innerHTML = '<div role="menubar" class="cmd"><button role="menuitem">+ New flow</button><button role="menuitem">Import</button></div>' +
        '<div class="canvas"><div class="card">My flows</div></div>';
    } else {
      app.innerHTML = '<div class="canvas"><div class="card">Home</div></div>';
    }
  }
  window.navigateTo = (path) => { history.pushState({}, '', path); render(); };
  addEventListener('popstate', render);
  render();
  // The portal calls the Flow API and Dataverse with bearer tokens.
  window.callApis = async (flowToken, dvToken) => {
    await fetch(${JSON.stringify(API)} + '/providers/Microsoft.ProcessSimple/environments/' + ENV_ID + '/flows/${FLOW_ID}?api-version=2016-11-01', { headers: { Authorization: flowToken } }).catch(() => {});
    await fetch(${JSON.stringify(DV)} + '/api/data/v9.2/workflows(${WF_ID})?$select=name', { headers: { Authorization: dvToken } }).catch(() => {});
  };
</script></body></html>`;

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--disable-default-apps'],
  viewport: { width: 1200, height: 560 },
});

const cors = { 'access-control-allow-origin': MAKER, 'access-control-allow-headers': 'authorization,content-type,x-ms-client-request-id,odata-version,odata-maxversion', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
await ctx.route(`${MAKER}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: makerHtml }));
await ctx.route(`${API}/**`, (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const url = route.request().url();
  if (url.includes('checkFlow')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' });
  return route.fulfill({ status: 200, headers: { ...cors, 'x-ms-service-request-id': 'svc-123' }, contentType: 'application/json', body: JSON.stringify(flowResponse) });
});
await ctx.route(`${DV}/**`, (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ '@odata.etag': 'W/"1"', workflowid: WF_ID, name: 'x' }) });
});

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const swErrors = [];
sw.on('console', (m) => { if (m.type() === 'error') swErrors.push(m.text()); });
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const BTN = '[data-pa-toolkit-button]';
const shot = async (page, name) => { const p = path.join(out, `pa-platform-${name}.png`); await page.screenshot({ path: p }); console.log('saved', p); };

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${MAKER}/environments/${ENV_ID}/flows/${FLOW_ID}`);
await page.waitForSelector(BTN, { timeout: 10000 });
await page.waitForTimeout(500);
check('button injected once on the designer', (await page.locator(BTN).count()) === 1);
const placement = await page.locator(BTN).getAttribute('data-placement');
check('button placed in the designer command bar (not the portal header)', placement === 'toolbar' &&
  await page.evaluate(() => !!document.querySelector('[aria-label="Designer commands"] [data-pa-toolkit-button]')));
const prev = await page.evaluate(() => document.querySelector('[data-pa-toolkit-button]').previousElementSibling?.textContent);
check('button sits after the last designer command', prev === 'Test', `previous sibling: ${prev}`);
const style = await page.evaluate(() => { const b = document.querySelector('[data-pa-toolkit-button] button'); const cs = getComputedStyle(b); return { color: cs.color, font: cs.fontFamily, label: b.getAttribute('aria-label') }; });
check('inherits host colour/font and has an aria-label', style.color === 'rgb(36, 36, 36)' && /Segoe UI/.test(style.font) && /Edit JSON/.test(style.label), JSON.stringify(style));
await shot(page, 'designer-button');
await page.locator(`${BTN} button`).focus();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, 'pa-platform-designer-button-focus.png'), clip: { x: 0, y: 40, width: 900, height: 70 } });

// Mutation churn must not duplicate
await page.evaluate(() => { for (let i = 0; i < 20; i++) document.body.appendChild(document.createElement('div')); });
await page.waitForTimeout(300);
check('no duplicates after DOM churn', (await page.locator(BTN).count()) === 1);

// SPA navigation: list → other → back to flow
await page.evaluate((env) => window.navigateTo(`/environments/${env}/flows`), ENV_ID);
await page.waitForTimeout(600);
const listId = await page.locator(BTN).getAttribute('data-pa-toolkit-button').catch(() => null);
check('flows list page shows the flows-list button', (await page.locator(BTN).count()) === 1 && listId === 'flows-list', `id=${listId}`);
await shot(page, 'flows-list-button');
await page.evaluate((env) => window.navigateTo(`/environments/${env}/connections`), ENV_ID);
await page.waitForTimeout(600);
check('removed on a non-flow page', (await page.locator(BTN).count()) === 0);
await page.evaluate(({ env, flow }) => window.navigateTo(`/environments/${env}/flows/${flow}`), { env: ENV_ID, flow: FLOW_ID });
await page.waitForTimeout(600);
check('re-inserted after pushState back to the flow', (await page.locator(BTN).count()) === 1 && (await page.locator(BTN).getAttribute('data-pa-toolkit-button')) === 'edit-json');
await page.goBack(); await page.waitForTimeout(600);
await page.goForward(); await page.waitForTimeout(600);
check('survives back/forward (popstate)', (await page.locator(BTN).count()) === 1);

// Token capture (flow + dataverse), then click → editor tab
await page.evaluate(({ f, d }) => window.callApis(f, d), { f: FLOW_TOKEN, d: DV_TOKEN });
await page.waitForTimeout(800);
const editorPromise = ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null);
await page.locator(`${BTN} button`).click();
const editor = await editorPromise;
check('click opens the editor tab', !!editor && editor.url().includes(`flow-editor.html?envId=${ENV_ID}&flowId=${FLOW_ID}`), editor?.url());
if (editor) {
  await editor.setViewportSize({ width: 1200, height: 700 });
  const dvSeen = [];
  editor.on('request', (r) => { if (r.url().startsWith(DV)) dvSeen.push(r.url()); });
  await editor.waitForSelector('.monaco-editor', { timeout: 20000 }).catch(() => {});
  await editor.waitForTimeout(1500);
  check('editor loaded the flow with the captured token', await editor.getByText('Invoice Approval - Finance').first().isVisible().catch(() => false));
  await shot(editor, 'editor-opened');
  // The editor page received the per-audience fields; ask the background for diagnostics.
  const diag = await editor.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'get-diagnostics' }, r)));
  const text = diag?.text || '';
  check('diagnostics list flow + dataverse token presence', /flow: host=unitedstates\.api\.flow\.microsoft\.com hasToken=true/.test(text) && /dataverse: host=contoso\.crm\.dynamics\.com/.test(text));
  check('diagnostics contain the API request id', /svc=svc-123/.test(text));
  check('diagnostics contain no token material', !/eyJ|Bearer/.test(text));
  check('dataverse workflow id captured', /Dataverse workflow id known: true/.test(text));
  fs.writeFileSync(path.join(out, 'pa-platform-diagnostics.txt'), text);
}

// Content scripts must not be able to use privileged messages
const denied = await page.evaluate(() => new Promise((r) => window.postMessage({ source: 'pa-toolkit-bridge', id: 1, message: { type: 'get-diagnostics' } }, location.origin) || setTimeout(() => r('ignored'), 300)));
check('bridge ignores non-whitelisted types', denied === 'ignored');

// Master switch / designer toggle
await sw.evaluate(async () => { const cur = (await chrome.storage.local.get('appSettings')).appSettings || {}; await chrome.storage.local.set({ appSettings: { ...cur, showDesignerButton: false } }); });
await page.waitForTimeout(500);
check('showDesignerButton=false removes the button', (await page.locator(BTN).count()) === 0);
await sw.evaluate(async () => { const cur = (await chrome.storage.local.get('appSettings')).appSettings || {}; await chrome.storage.local.set({ appSettings: { ...cur, showDesignerButton: true, extensionEnabled: false } }); });
await page.waitForTimeout(800);
check('extensionEnabled=false keeps the button hidden', (await page.locator(BTN).count()) === 0);
const title = await sw.evaluate(() => chrome.action.getTitle({}));
check('action title shows turned off', /turned off/.test(title), title);
check('grey action icon applied', !swErrors.some((e) => /set action icon/i.test(e)), swErrors.filter((e) => /icon/i.test(e)).join(' | '));
await sw.evaluate(async () => { const cur = (await chrome.storage.local.get('appSettings')).appSettings || {}; await chrome.storage.local.set({ appSettings: { ...cur, extensionEnabled: true } }); });
await page.waitForTimeout(800);
check('re-enabling restores the button', (await page.locator(BTN).count()) === 1);

// Content script is not injected on arbitrary sites any more
await ctx.route('https://blog.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p class="powerAutomateCode">{}</p>' }));
const blog = await ctx.newPage();
await blog.goto('https://blog.example.com/post');
await blog.waitForTimeout(500);
const injected = await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://blog.example.com/*' });
  return new Promise((r) => chrome.tabs.sendMessage(tab.id, { actionType: 999 }, () => r(!chrome.runtime.lastError)));
});
check('no content script on unrelated sites by default', injected === false);

// Fallback: designer without a recognisable command bar → floating button after the grace period
await page.bringToFront();
await page.evaluate(({ env, flow }) => window.navigateTo(`/environments/${env}/flows/${flow}?bare=1`), { env: ENV_ID, flow: FLOW_ID });
await page.waitForTimeout(800);
check('no floating button before the grace period', (await page.locator(BTN).count()) === 0);
await page.waitForTimeout(4500);
check('floating fallback button appears once', (await page.locator(BTN).count()) === 1 && (await page.locator(BTN).getAttribute('data-placement')) === 'floating');
await shot(page, 'floating-fallback');

check('no page errors on the maker page', errors.length === 0, errors.join(' | '));
console.log(results.join('\n'));
await ctx.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
