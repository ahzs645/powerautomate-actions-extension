import { type BrowserContext, type Page, type Worker, chromium } from '@playwright/test';
import path from 'path';
import { API_HOST, FAKE_TOKEN } from './flow-data';

const EXTENSION_PATH = path.resolve(__dirname, '../../build');

/**
 * Launch a browser with the extension loaded.
 * Returns the context, extension ID, and service worker handle.
 */
export async function launchWithExtension() {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    // Use a preinstalled Chromium when the one matching this Playwright version
    // is not downloaded (e.g. sandboxed CI): PW_CHROMIUM_EXECUTABLE=/path/to/chrome
    executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  // Wait for the service worker to register
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  // Extract extension ID from the service worker URL
  const extensionId = serviceWorker.url().split('/')[2];

  return { context, extensionId, serviceWorker };
}

/**
 * Open the extension popup in a new tab (workaround since we can't click the toolbar icon).
 */
export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}

/**
 * Open the flow editor directly (bypassing the popup "Edit Flow JSON" click).
 * This simulates what Background.ts does when it creates the editor tab.
 */
export async function openFlowEditor(
  context: BrowserContext,
  extensionId: string,
  envId: string,
  flowId: string
): Promise<Page> {
  const editor = await context.newPage();
  await editor.goto(
    `chrome-extension://${extensionId}/flow-editor.html?envId=${envId}&flowId=${flowId}`
  );
  await editor.waitForLoadState('domcontentloaded');
  return editor;
}

/**
 * Mock the Power Automate API on a page so the flow editor can fetch data.
 * Intercepts fetch requests to the API host and returns mock flow responses.
 */
export async function mockFlowApi(
  page: Page,
  envId: string,
  flowId: string,
  flowResponse: any
) {
  await page.route(`${API_HOST}/**`, (route) => {
    const url = route.request().url();

    // GET flow definition
    if (
      url.includes(`/environments/${envId}/flows/${flowId}`) &&
      route.request().method() === 'GET'
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(flowResponse),
      });
    }

    // PATCH save flow
    if (
      url.includes(`/environments/${envId}/flows/${flowId}`) &&
      route.request().method() === 'PATCH'
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(flowResponse),
      });
    }

    // POST validate (errors)
    if (url.includes('/checkFlowErrors')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }

    // POST validate (warnings)
    if (url.includes('/checkFlowWarnings')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }

    // Fallback
    return route.fulfill({ status: 404, body: 'Not found' });
  });
}

/**
 * Send a token-changed message to the flow editor tab via the service worker.
 *
 * This is how it works in production: Background.ts calls
 * chrome.tabs.sendMessage(editorTabId, { type: 'token-changed', token, apiUrl })
 *
 * We replicate this by evaluating inside the service worker, finding the
 * editor tab by URL, and sending the message to it.
 */
export async function injectToken(
  page: Page,
  serviceWorker: Worker
) {
  const editorUrl = page.url();

  await serviceWorker.evaluate(
    async ({ editorUrl, token, apiUrl }) => {
      // Find the editor tab by its URL
      const allTabs = await chrome.tabs.query({});
      const editorTab = allTabs.find((t) => t.url === editorUrl);

      if (!editorTab?.id) {
        throw new Error(`Could not find editor tab with URL: ${editorUrl}`);
      }

      // Send the token-changed message exactly as Background.ts does
      chrome.tabs.sendMessage(editorTab.id, {
        type: 'token-changed',
        token,
        apiUrl,
      });
    },
    { editorUrl, token: FAKE_TOKEN, apiUrl: API_HOST + '/' }
  );

  // Wait for React state to update after receiving the message
  await page.waitForTimeout(1000);
}
