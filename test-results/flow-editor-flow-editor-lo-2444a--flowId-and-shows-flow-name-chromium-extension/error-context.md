# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: flow-editor.spec.ts >> flow editor loads Flow A with correct envId/flowId and shows flow name
- Location: e2e/flow-editor.spec.ts:45:5

# Error details

```
Error: browserType.launchPersistentContext: Executable doesn't exist at /Users/ahmadjalil/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     npx playwright install                                 ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```

```
TypeError: Cannot read properties of undefined (reading 'close')
```

# Test source

```ts
  1   | import { test, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
  2   | import {
  3   |   launchWithExtension,
  4   |   openFlowEditor,
  5   |   openPopup,
  6   |   mockFlowApi,
  7   |   injectToken,
  8   | } from './fixtures/extension-helpers';
  9   | import { ENV_ID, FLOW_A, FLOW_B } from './fixtures/flow-data';
  10  | 
  11  | let context: BrowserContext;
  12  | let extensionId: string;
  13  | let serviceWorker: Worker;
  14  | 
  15  | test.beforeAll(async () => {
  16  |   const result = await launchWithExtension();
  17  |   context = result.context;
  18  |   extensionId = result.extensionId;
  19  |   serviceWorker = result.serviceWorker;
  20  | });
  21  | 
  22  | test.afterAll(async () => {
> 23  |   await context.close();
      |                 ^ TypeError: Cannot read properties of undefined (reading 'close')
  24  | });
  25  | 
  26  | /** Helper: open editor, mock API, inject token, wait for flow to load */
  27  | async function openAndLoadFlow(
  28  |   flowId: string,
  29  |   flowName: string,
  30  |   flowResponse: any
  31  | ): Promise<Page> {
  32  |   const editor = await openFlowEditor(context, extensionId, ENV_ID, flowId);
  33  |   await mockFlowApi(editor, ENV_ID, flowId, flowResponse);
  34  |   await injectToken(editor, serviceWorker);
  35  |   // Wait for the success message which confirms data loaded
  36  |   await expect(
  37  |     editor.getByText(`Flow "${flowName}" loaded successfully.`)
  38  |   ).toBeVisible({ timeout: 15_000 });
  39  |   return editor;
  40  | }
  41  | 
  42  | /**
  43  |  * TEST 1: Flow editor opens with correct URL parameters and loads flow data.
  44  |  */
  45  | test('flow editor loads Flow A with correct envId/flowId and shows flow name', async () => {
  46  |   const editor = await openFlowEditor(context, extensionId, ENV_ID, FLOW_A.id);
  47  | 
  48  |   // Verify the URL params
  49  |   const url = new URL(editor.url());
  50  |   expect(url.searchParams.get('envId')).toBe(ENV_ID);
  51  |   expect(url.searchParams.get('flowId')).toBe(FLOW_A.id);
  52  | 
  53  |   // Should show spinner while waiting for auth
  54  |   await expect(editor.getByText('Connecting to Power Automate...')).toBeVisible();
  55  | 
  56  |   // Mock API and inject token via service worker
  57  |   await mockFlowApi(editor, ENV_ID, FLOW_A.id, FLOW_A.response);
  58  |   await injectToken(editor, serviceWorker);
  59  | 
  60  |   // Wait for success message (confirms flow loaded and name is in CommandBar)
  61  |   await expect(
  62  |     editor.getByText(`Flow "${FLOW_A.name}" loaded successfully.`)
  63  |   ).toBeVisible({ timeout: 15_000 });
  64  | 
  65  |   // Verify flow name is in the CommandBar
  66  |   await expect(
  67  |     editor.getByRole('menuitem', { name: FLOW_A.name })
  68  |   ).toBeVisible();
  69  | 
  70  |   // Verify Monaco editor rendered
  71  |   const monacoEditor = editor.locator('.monaco-editor');
  72  |   await expect(monacoEditor).toBeVisible();
  73  | 
  74  |   // Verify editor content has expected JSON structure
  75  |   const content = await getEditorContent(editor);
  76  |   expect(content).toContain('"$schema"');
  77  |   expect(content).toContain('"connectionReferences"');
  78  |   expect(content).toContain('"definition"');
  79  |   expect(content).toContain('Send_an_email');
  80  | 
  81  |   await editor.close();
  82  | });
  83  | 
  84  | /**
  85  |  * TEST 2: Two flow editors open simultaneously with independent state.
  86  |  */
  87  | test('two flow editors show independent flow data', async () => {
  88  |   const editorA = await openAndLoadFlow(FLOW_A.id, FLOW_A.name, FLOW_A.response);
  89  |   const editorB = await openAndLoadFlow(FLOW_B.id, FLOW_B.name, FLOW_B.response);
  90  | 
  91  |   // Verify Flow A editor still shows Flow A
  92  |   await editorA.bringToFront();
  93  |   await expect(editorA.getByRole('menuitem', { name: FLOW_A.name })).toBeVisible();
  94  |   const contentA = await getEditorContent(editorA);
  95  |   expect(contentA).toContain('Send_an_email');
  96  |   expect(contentA).not.toContain('Update_item');
  97  | 
  98  |   // Verify Flow B editor shows Flow B
  99  |   await editorB.bringToFront();
  100 |   await expect(editorB.getByRole('menuitem', { name: FLOW_B.name })).toBeVisible();
  101 |   const contentB = await getEditorContent(editorB);
  102 |   expect(contentB).toContain('Update_item');
  103 |   expect(contentB).not.toContain('Send_an_email');
  104 | 
  105 |   await editorA.close();
  106 |   await editorB.close();
  107 | });
  108 | 
  109 | /**
  110 |  * TEST 3: Auth timeout after 30 seconds with no token.
  111 |  */
  112 | test('flow editor shows auth timeout when no token is received', async () => {
  113 |   const editor = await openFlowEditor(context, extensionId, ENV_ID, FLOW_A.id);
  114 | 
  115 |   await expect(editor.getByText('Connecting to Power Automate...')).toBeVisible();
  116 | 
  117 |   // Wait for the 30s timeout (flow-editor.tsx:56-61)
  118 |   await expect(
  119 |     editor.getByText('Authentication timeout. Please refresh the Power Automate page and try again.')
  120 |   ).toBeVisible({ timeout: 35_000 });
  121 | 
  122 |   await editor.close();
  123 | });
```