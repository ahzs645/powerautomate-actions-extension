import { test, expect, type BrowserContext, type Locator, type Page, type Worker } from '@playwright/test';
import {
  launchWithExtension,
  openFlowEditor,
  openPopup,
  mockFlowApi,
  injectToken,
} from './fixtures/extension-helpers';
import { ENV_ID, FLOW_A, FLOW_B } from './fixtures/flow-data';

let context: BrowserContext;
let extensionId: string;
let serviceWorker: Worker;

test.beforeAll(async () => {
  const result = await launchWithExtension();
  context = result.context;
  extensionId = result.extensionId;
  serviceWorker = result.serviceWorker;
});

test.afterAll(async () => {
  await context.close();
});

/** Helper: open editor, mock API, inject token, wait for flow to load */
async function openAndLoadFlow(
  flowId: string,
  flowName: string,
  flowResponse: any
): Promise<Page> {
  const editor = await openFlowEditor(context, extensionId, ENV_ID, flowId);
  await mockFlowApi(editor, ENV_ID, flowId, flowResponse);
  await injectToken(editor, serviceWorker);
  // Wait for the success message which confirms data loaded
  await expect(
    editor.getByText(`Flow "${flowName}" loaded successfully.`)
  ).toBeVisible({ timeout: 15_000 });
  return editor;
}

/**
 * TEST 1: Flow editor opens with correct URL parameters and loads flow data.
 */
test('flow editor loads Flow A with correct envId/flowId and shows flow name', async () => {
  const editor = await openFlowEditor(context, extensionId, ENV_ID, FLOW_A.id);

  // Verify the URL params
  const url = new URL(editor.url());
  expect(url.searchParams.get('envId')).toBe(ENV_ID);
  expect(url.searchParams.get('flowId')).toBe(FLOW_A.id);

  // Should show spinner while waiting for auth
  await expect(editor.getByText('Connecting to Power Automate...')).toBeVisible();

  // Mock API and inject token via service worker
  await mockFlowApi(editor, ENV_ID, FLOW_A.id, FLOW_A.response);
  await injectToken(editor, serviceWorker);

  // Wait for success message (confirms flow loaded and name is in CommandBar)
  await expect(
    editor.getByText(`Flow "${FLOW_A.name}" loaded successfully.`)
  ).toBeVisible({ timeout: 15_000 });

  // The flow name is the page heading (not a command bar button)
  await expect(
    editor.getByRole('heading', { name: FLOW_A.name })
  ).toBeVisible();
  await expect(editor).toHaveTitle(`${FLOW_A.name} — Flow editor`);

  // Verify Monaco editor rendered
  const monacoEditor = editor.locator('.monaco-editor');
  await expect(monacoEditor).toBeVisible();

  // Verify editor content has expected JSON structure
  const content = await getEditorContent(editor);
  expect(content).toContain('"$schema"');
  expect(content).toContain('"connectionReferences"');
  expect(content).toContain('"definition"');
  expect(content).toContain('Send_an_email');

  await editor.close();
});

/**
 * TEST 2: Two flow editors open simultaneously with independent state.
 */
test('two flow editors show independent flow data', async () => {
  const editorA = await openAndLoadFlow(FLOW_A.id, FLOW_A.name, FLOW_A.response);
  const editorB = await openAndLoadFlow(FLOW_B.id, FLOW_B.name, FLOW_B.response);

  // Verify Flow A editor still shows Flow A
  await editorA.bringToFront();
  await expect(editorA.getByRole('heading', { name: FLOW_A.name })).toBeVisible();
  const contentA = await getEditorContent(editorA);
  expect(contentA).toContain('Send_an_email');
  expect(contentA).not.toContain('Update_item');

  // Verify Flow B editor shows Flow B
  await editorB.bringToFront();
  await expect(editorB.getByRole('heading', { name: FLOW_B.name })).toBeVisible();
  const contentB = await getEditorContent(editorB);
  expect(contentB).toContain('Update_item');
  expect(contentB).not.toContain('Send_an_email');

  await editorA.close();
  await editorB.close();
});

/**
 * TEST 3: Auth timeout after 30 seconds with no token.
 */
test('flow editor shows auth timeout when no token is received', async () => {
  const editor = await openFlowEditor(context, extensionId, ENV_ID, FLOW_A.id);

  await expect(editor.getByText('Connecting to Power Automate...')).toBeVisible();

  // Wait for the 30s timeout; the page explains what to do instead of going blank
  await expect(
    editor.getByRole('heading', { name: "Couldn't connect to Power Automate" })
  ).toBeVisible({ timeout: 35_000 });
  await expect(editor.getByRole('button', { name: 'Retry' })).toBeVisible();

  await editor.close();
});

/**
 * TEST 4: Missing URL params shows error.
 */
test('flow editor shows error when URL params are missing', async () => {
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/flow-editor.html`);
  await editor.waitForLoadState('domcontentloaded');

  await expect(
    editor.getByRole('heading', { name: 'Open this from a flow in Power Automate' })
  ).toBeVisible({ timeout: 5_000 });

  await editor.close();
});

/**
 * TEST 5: CommandBar buttons are present after flow loads.
 */
test('command bar buttons are present after flow loads', async () => {
  const editor = await openAndLoadFlow(FLOW_A.id, FLOW_A.name, FLOW_A.response);

  const commandBar = editor.locator('.ms-CommandBar');
  await expect(commandBar).toBeVisible();

  // Primary and Check groups are on the bar. CommandBar renders buttons — try both
  // 'menuitem' and 'button' roles.
  for (const name of ['Save', 'Publish', 'Validate', 'Analyze', 'Compare']) {
    const button = editor.getByRole('menuitem', { name, exact: true }).or(editor.getByRole('button', { name, exact: true }));
    await expect(button).toBeVisible();
  }

  // The rest lives in the overflow menu.
  await editor.getByRole('menuitem', { name: 'More commands' }).or(editor.getByRole('button', { name: 'More commands' })).first().click();
  for (const name of ['Download JSON', 'Reconnect', 'Analyze solution (.zip)', 'Save method', 'Copy diagnostics']) {
    await expect(editor.getByRole('menuitem', { name })).toBeVisible();
  }

  await editor.close();
});

/**
 * TEST 5b: A solution flow shows its badge; the Save method submenu defaults to
 * the Flow service and keeps Dataverse disabled without a Dataverse sign-in.
 */
test('solution flow shows a badge and the Save method submenu', async () => {
  const solutionResponse = {
    ...FLOW_A.response,
    properties: { ...FLOW_A.response.properties, workflowEntityId: 'a1b2c3d4-0000-1111-2222-333344445555' },
  };
  const editor = await openAndLoadFlow(FLOW_A.id, FLOW_A.name, solutionResponse);

  await expect(editor.getByText('Solution flow', { exact: true })).toBeVisible();

  await editor.getByRole('menuitem', { name: 'More commands' }).or(editor.getByRole('button', { name: 'More commands' })).first().click();
  await editor.getByRole('menuitem', { name: 'Save method' }).hover();
  const flowService = editor.getByRole('menuitemcheckbox', { name: 'Flow service (default)' });
  const dataverse = editor.getByRole('menuitemcheckbox', { name: /Dataverse/ });
  await expect(flowService).toBeVisible();
  await expect(flowService).toHaveAttribute('aria-checked', 'true');
  await expect(dataverse).toHaveAttribute('aria-disabled', 'true');
  await expect(dataverse).toHaveAttribute('title', /No Dataverse sign-in/);

  await editor.close();
});

/**
 * TEST 6: Validate flow with no errors.
 */
test('validate flow shows no issues for valid definition', async () => {
  const editor = await openAndLoadFlow(FLOW_A.id, FLOW_A.name, FLOW_A.response);

  // Click Validate
  const validateBtn = editor.getByRole('menuitem', { name: 'Validate' }).or(editor.getByRole('button', { name: 'Validate' }));
  await validateBtn.click();

  // Mock returns empty arrays → "no issues found"
  await expect(
    editor.getByText('Validation completed - no issues found.')
  ).toBeVisible({ timeout: 10_000 });

  await editor.close();
});

/**
 * TEST 7: Download JSON triggers a file download.
 */
test('download JSON produces a file with the flow name', async () => {
  const editor = await openAndLoadFlow(FLOW_A.id, FLOW_A.name, FLOW_A.response);

  const downloadPromise = editor.waitForEvent('download');

  await editor.getByRole('menuitem', { name: 'More commands' }).or(editor.getByRole('button', { name: 'More commands' })).first().click();
  const downloadBtn = editor.getByRole('menuitem', { name: 'Download JSON' });
  await downloadBtn.click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${FLOW_A.name}.json`);

  await editor.close();
});

test('finds a nested action and the specific field that reads a setting', async () => {
  const fixture = FLOW_A.response.properties;
  const editor = await openAndLoadFlow(FLOW_A.id, FLOW_A.name, { ...FLOW_A.response, properties: { ...fixture, definition: {
    ...fixture.definition,
    parameters: { 'Site (demo_site)': { type: 'String' } },
    actions: { Check_site: { type: 'Scope', actions: { Lookup_site: { type: 'Compose', inputs: "@parameters('Site (demo_site)')" } } } },
  } } });
  const more = editor.getByRole('menuitem', { name: 'More commands' }).or(editor.getByRole('button', { name: 'More commands' })).first();
  const find = editor.getByRole('menuitem', { name: 'Find action', exact: true }).or(editor.getByRole('button', { name: 'Find action', exact: true }));
  if (!await find.isVisible()) await more.click();
  await find.click();
  await editor.getByRole('searchbox', { name: 'Search steps' }).fill('lookup site');
  await editor.getByText('Check_site › Lookup_site', { exact: true }).click();
  await expect(editor.getByRole('heading', { name: 'Find action' })).toBeHidden();

  await more.click();
  await editor.getByRole('menuitem', { name: 'Environment variables · Where used' }).click();
  await editor.getByText('Where used (1)', { exact: true }).click();
  await editor.getByText('Check_site › Lookup_site · inputs', { exact: true }).click();
  await expect(editor.getByRole('heading', { name: 'Environment variables and flow parameters' })).toBeHidden();

  await editor.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => sessionStorage.setItem('test:clipboard', value),
    } });
  });
  await more.click();
  await editor.getByRole('menuitem', { name: 'Copy dynamic run link' }).click();
  await expect(editor.getByText('Dynamic run link expression copied.')).toBeVisible();
  expect(await editor.evaluate(() => sessionStorage.getItem('test:clipboard'))).toMatch(/workflow\(\)\?\['run'\]\?\['name'\]/);

  await more.click();
  await editor.getByRole('menuitem', { name: 'Check availability' }).click();
  await expect(editor.getByRole('heading', { name: 'Connection availability' })).toBeVisible();
  await expect(editor.getByText('Available', { exact: true })).toBeVisible();
  await expect(editor.getByText('Dataverse sign-in has not been captured.')).toBeVisible();
  await editor.close();
});

test('definition-only edits save with the original connection references', async () => {
  const editor = await openAndLoadFlow(FLOW_A.id, FLOW_A.name, FLOW_A.response);
  const original = FLOW_A.response.properties;
  const edited = { ...original.definition, contentVersion: '2.0.0.0' };
  await editor.getByRole('radio', { name: 'Definition only' }).click();
  const definition = editor.getByRole('textbox', { name: 'Flow definition JSON' });
  await expect(definition).toBeVisible();
  await pasteEditorJson(definition, edited);
  await expect(editor.getByText('Unsaved changes', { exact: true })).toBeVisible();

  await editor.getByRole('menuitem', { name: 'Save', exact: true })
    .or(editor.getByRole('button', { name: 'Save', exact: true })).click();
  const confirmation = editor.getByRole('alertdialog').or(editor.getByRole('dialog'));
  await expect(confirmation.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(confirmation.getByText('Connection changes', { exact: true })).toHaveCount(0);
  const patch = editor.waitForRequest(request => request.method() === 'PATCH');
  await confirmation.getByRole('button', { name: 'Save', exact: true }).click();
  const payload = (await patch).postDataJSON();
  expect(payload.properties.definition).toEqual(edited);
  expect(payload.properties.connectionReferences).toEqual(original.connectionReferences);
  await expect(editor.getByText(`Flow "${FLOW_A.name}" saved.`)).toBeVisible();
  await expect(editor.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await editor.close();
});

test('shows connection changes before save and blocks a missing reference', async () => {
  const editor = await openAndLoadFlow(FLOW_A.id, FLOW_A.name, FLOW_A.response);
  const original = FLOW_A.response.properties;
  const [alias, binding] = Object.entries(original.connectionReferences)[0];
  const full = editor.getByRole('textbox', { name: 'Full flow JSON' });
  const save = editor.getByRole('menuitem', { name: 'Save', exact: true })
    .or(editor.getByRole('button', { name: 'Save', exact: true }));

  await pasteEditorJson(full, {
    definition: original.definition, connectionReferences: { [alias]: { ...binding, connectionName: 'other' } },
  });
  await save.click();
  const confirmation = editor.getByRole('alertdialog').or(editor.getByRole('dialog'));
  await expect(confirmation.getByText(`Changed reference ${alias}`)).toBeVisible();
  await expect(confirmation.getByText(/Action Send_an_email/)).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();

  await pasteEditorJson(full, { definition: original.definition, connectionReferences: {} });
  await save.click();
  await expect(editor.getByText(/Cannot save.*uses missing connection reference/)).toBeVisible();
  await expect(confirmation).toHaveCount(0);
  // Undo the test edits to avoid leaving a draft in the shared extension session.
  await full.focus();
  await full.press('ControlOrMeta+z');
  await full.press('ControlOrMeta+z');
  await expect(editor.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await editor.close();
});

test('offers to restore unsaved work after reopening a flow', async () => {
  const editor = await openAndLoadFlow(FLOW_B.id, FLOW_B.name, FLOW_B.response);
  const original = FLOW_B.response.properties;
  const draft = { ...original.definition, contentVersion: '2.0.0.0' };
  await editor.getByRole('radio', { name: 'Definition only' }).click();
  await pasteEditorJson(editor.getByRole('textbox', { name: 'Flow definition JSON' }), draft);
  const recoveryKey = `paToolkit.flowEditor.recovery:${ENV_ID.toLowerCase()}:${FLOW_B.id.toLowerCase()}`;
  await expect.poll(async () => serviceWorker.evaluate(async (key) => {
    const state = await chrome.storage.session.get(key);
    return JSON.parse(state[key]?.text ?? '{}').definition?.contentVersion;
  }, recoveryKey)).toBe('2.0.0.0');
  await editor.close();

  const reopened = await openAndLoadFlow(FLOW_B.id, FLOW_B.name, FLOW_B.response);
  await reopened.getByRole('button', { name: 'Restore my work' }).click();
  await expect(reopened.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await reopened.getByRole('radio', { name: 'Definition only' }).click();
  await expect(reopened.locator('.monaco-editor:visible .view-lines')).toContainText('2.0.0.0');
  await reopened.close();
  await serviceWorker.evaluate(key => chrome.storage.session.remove(key), recoveryKey);
});

/**
 * TEST 8: Popup tab switching between Recorded, Copied, Favorites and Library.
 */
test('popup pivot tabs switch between action lists', async () => {
  const popup = await openPopup(context, extensionId);

  const recordedTab = popup.getByRole('tab', { name: /^Recorded/ });
  await expect(recordedTab).toBeVisible();
  await expect(recordedTab).toHaveAttribute('aria-selected', 'true');

  const copiedTab = popup.getByRole('tab', { name: /^Copied/ });
  await copiedTab.click();
  await expect(copiedTab).toHaveAttribute('aria-selected', 'true');

  const favoritesTab = popup.getByRole('tab', { name: /^Favorites/ });
  await favoritesTab.click();
  await expect(favoritesTab).toHaveAttribute('aria-selected', 'true');

  const libraryTab = popup.getByRole('tab', { name: /^Library/ });
  await libraryTab.click();
  await expect(libraryTab).toHaveAttribute('aria-selected', 'true');

  await popup.close();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function pasteEditorJson(editor: Locator, value: unknown) {
  await editor.focus();
  await editor.press('ControlOrMeta+a');
  await editor.evaluate((input, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, JSON.stringify(value, null, 2));
}

async function getEditorContent(page: Page): Promise<string> {
  // Monaco may expose models through different paths depending on how it's bundled.
  // Try multiple approaches, then fall back to reading the DOM text.
  const content = await page.evaluate(() => {
    // Approach 1: Global monaco from @monaco-editor/react loader
    const m = (window as any).monaco;
    if (m?.editor?.getModels) {
      const models = m.editor.getModels();
      if (models?.[0]) return models[0].getValue();
    }
    // Approach 2: Try __MONACO_EDITOR__ or similar globals
    const keys = Object.keys(window).filter(k => k.toLowerCase().includes('monaco'));
    for (const key of keys) {
      const mod = (window as any)[key];
      if (mod?.editor?.getModels) {
        const models = mod.editor.getModels();
        if (models?.[0]) return models[0].getValue();
      }
    }
    return '';
  });

  if (content) return content;

  // Fallback: read the visible text from Monaco's view lines
  const lines = await page.locator('.monaco-editor .view-lines .view-line').allTextContents();
  return lines.join('\n');
}
