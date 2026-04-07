import { test, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
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

  // Verify flow name is in the CommandBar
  await expect(
    editor.getByRole('menuitem', { name: FLOW_A.name })
  ).toBeVisible();

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
  await expect(editorA.getByRole('menuitem', { name: FLOW_A.name })).toBeVisible();
  const contentA = await getEditorContent(editorA);
  expect(contentA).toContain('Send_an_email');
  expect(contentA).not.toContain('Update_item');

  // Verify Flow B editor shows Flow B
  await editorB.bringToFront();
  await expect(editorB.getByRole('menuitem', { name: FLOW_B.name })).toBeVisible();
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

  // Wait for the 30s timeout (flow-editor.tsx:56-61)
  await expect(
    editor.getByText('Authentication timeout. Please refresh the Power Automate page and try again.')
  ).toBeVisible({ timeout: 35_000 });

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
    editor.getByText('Invalid URL parameters. Please open the extension from a Power Automate flow page.')
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

  // Check each button. CommandBar renders buttons — try both 'menuitem' and 'button' roles.
  for (const name of ['Save', 'Validate', 'Analyze', 'Compare', 'Download JSON', 'Refresh Token']) {
    const button = editor.getByRole('menuitem', { name }).or(editor.getByRole('button', { name }));
    await expect(button).toBeVisible();
  }

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

  const downloadBtn = editor.getByRole('menuitem', { name: 'Download JSON' }).or(editor.getByRole('button', { name: 'Download JSON' }));
  await downloadBtn.click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${FLOW_A.name}.json`);

  await editor.close();
});

/**
 * TEST 8: Popup tab switching between Recorded Requests, Copied Actions, Favorites.
 */
test('popup pivot tabs switch between action lists', async () => {
  const popup = await openPopup(context, extensionId);

  const recordedTab = popup.getByRole('tab', { name: 'Recorded Requests' });
  await expect(recordedTab).toBeVisible();
  await expect(recordedTab).toHaveAttribute('aria-selected', 'true');

  const copiedTab = popup.getByRole('tab', { name: 'Copied Actions' });
  await copiedTab.click();
  await expect(copiedTab).toHaveAttribute('aria-selected', 'true');

  const favoritesTab = popup.getByRole('tab', { name: 'Favorites' });
  await favoritesTab.click();
  await expect(favoritesTab).toHaveAttribute('aria-selected', 'true');

  await popup.close();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

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
