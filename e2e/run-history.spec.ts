import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { injectToken, launchWithExtension } from './fixtures/extension-helpers';
import { ENV_ID, FAKE_TOKEN, FLOW_A, FLOW_B } from './fixtures/flow-data';

const flowApiHost = 'https://canada.api.flow.microsoft.com';
const legacyPath = `/providers/Microsoft.ProcessSimple/environments/${ENV_ID}/flows/${FLOW_A.id}/runs`;
const env = ENV_ID.replace(/-/g, '');
const platformHost = `https://${env.slice(0, -2)}.${env.slice(-2)}.environment.api.powerplatform.com`;
const platformPath = `/powerautomate/flows/${FLOW_A.id}/runs`;

test('exports across history pages, retries detail authentication, and reports missing logs', async () => {
  const { context, serviceWorker } = await launchWithExtension();
  try {
    const makerUrl = `https://make.powerautomate.com/environments/${ENV_ID}/flows/${FLOW_A.id}/runs`;
    const maker = await context.newPage();
    await maker.route(makerUrl, route => route.fulfill({
      contentType: 'text/html',
      body: '<div role="menubar"><button role="menuitem">Edit flow</button><button role="menuitem">Get .csv file</button></div>',
    }));
    await maker.goto(makerUrl);
    const [exporter] = await Promise.all([
      context.waitForEvent('page'),
      maker.getByRole('menuitem', { name: 'Export runs (Power Automate Toolkit)' }).click(),
    ]);
    await expect(exporter.getByRole('heading', { name: 'Export flow runs' })).toBeVisible();

    // Calculate fixture boundaries in the extension tab's time zone.
    const range = await exporter.evaluate(() => ({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      startUtc: new Date(2026, 10, 1).toISOString(),
      endExclusiveUtc: new Date(2026, 10, 2).toISOString(),
    }));
    const from = new Date(range.startUtc);
    const after = new Date(range.endExclusiveUtc);
    const run = { name: 'run-a', properties: { status: 'Succeeded', startTime: from.toISOString() } };
    const older = { name: 'too-old', properties: { startTime: new Date(from.getTime() - 1).toISOString() } };
    const newer = { name: 'too-new', properties: { startTime: after.toISOString() } };
    const unavailable = { name: 'run-b', properties: { status: 'Failed', startTime: new Date(after.getTime() - 1).toISOString() } };
    const detail = { ...run, properties: {
      ...run.properties,
      trigger: { name: 'Manual', status: 'Succeeded' },
      actions: {
        Loop: { status: 'Succeeded', repetitionCount: 1, outputs: { count: 1 } },
        Lookup: {
          status: 'Succeeded',
          inputs: 'secure input sentinel',
          inputsLink: { secureData: { properties: ['inputs'] }, uri: 'https://example.invalid/?sig=secret' },
          outputs: { result: 'available' },
        },
      },
      flow: { properties: { displayName: FLOW_A.name, definition: { actions: { Loop: { type: 'Foreach' } } } } },
    } };
    const historyPages: string[] = [];
    const fallbackExpansions: string[] = [];
    await exporter.route(`${flowApiHost}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname === legacyPath) {
        const page = url.searchParams.get('$skiptoken') || 'first';
        historyPages.push(page);
        await route.fulfill({ json: page === 'first'
          ? { value: [run, older], nextLink: `${flowApiHost}${legacyPath}?api-version=2016-11-01&$skiptoken=second` }
          : { value: [run, unavailable, newer] },
        });
      } else if (url.pathname === `${legacyPath}/run-a/actions/Loop/scopeRepetitions`) {
        await route.fulfill({ json: { value: [{
          properties: { status: 'Succeeded', repetitionIndexes: [{ scopeName: 'Loop', itemIndex: 0 }] },
        }] } });
      } else if (url.pathname === `${legacyPath}/run-a`) {
        fallbackExpansions.push(url.searchParams.get('$expand') || '');
        await route.fulfill({ json: detail });
      } else if (url.pathname === `${legacyPath}/run-b`) {
        await route.fulfill({ status: 403 });
      } else {
        await route.fulfill({ status: 404 });
      }
    });
    const expansions: string[] = [];
    await exporter.route(`${platformHost}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname !== `${platformPath}/run-a`) {
        await route.fulfill({ status: 403 });
        return;
      }
      const expand = url.searchParams.get('$expand') || '';
      expansions.push(expand);
      if (expand.includes('properties/contents')) {
        await route.fulfill({ status: 401 });
      } else {
        await route.fulfill({ json: detail });
      }
    });
    await injectToken(exporter, serviceWorker, {
      legacyApiUrl: flowApiHost + '/', legacyToken: FAKE_TOKEN,
      powerPlatformApiUrl: platformHost + '/', powerPlatformToken: FAKE_TOKEN,
    });

    await exporter.getByLabel('Start date').fill('2026-11-01');
    await exporter.getByLabel('End date').fill('2026-11-01');
    await expect(exporter.getByRole('checkbox', { name: 'Include step inputs and outputs' })).not.toBeChecked();

    async function downloadArchive() {
      await exporter.getByRole('button', { name: 'Prepare export' }).click();
      await expect(exporter.getByText(/2 runs ready to download.*Some logs could not be retrieved/)).toBeVisible();
      const [download] = await Promise.all([
        exporter.waitForEvent('download'),
        exporter.getByRole('button', { name: 'Download ZIP' }).click(),
      ]);
      return JSZip.loadAsync(await readFile((await download.path())!));
    }

    const metadata = await downloadArchive();
    expect(expansions[0]).not.toContain('properties/contents');
    expect(await metadata.file('runs/run-a.json')!.async('string')).not.toContain('available');
    await exporter.getByText('Include step inputs and outputs', { exact: true }).click();
    await expect(exporter.getByRole('checkbox', { name: 'Include step inputs and outputs' })).toBeChecked();
    const zip = await downloadArchive();
    expect(expansions[1]).toContain('properties/contents');
    expect(fallbackExpansions).toEqual([expansions[1]]);
    expect(historyPages).toEqual(['first', 'second', 'first', 'second']);
    expect(zip.file('runs/too-old.json')).toBeNull();
    expect(zip.file('runs/too-new.json')).toBeNull();
    const summary = await zip.file('runs.csv')!.async('string');
    expect(summary).toContain('"run-b","Failed"');
    expect(await zip.file('steps.csv')!.async('string')).toContain('"iteration","Loop[0]"');
    const logText = await zip.file('runs/run-a.json')!.async('string');
    expect(logText).not.toMatch(/secure input sentinel|sig=secret/);
    const log = JSON.parse(logText);
    expect(log.actions[1]).toMatchObject({ outputs: { result: 'available' }, payloadStatus: { inputs: 'secured' } });
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({
      runCount: 2,
      stepCount: 4,
      range,
      issues: [{ runId: 'run-b', part: 'run details', httpStatus: 403 }],
    });

    await exporter.getByText('Excel · linked run summary and step sheets', { exact: true }).click();
    await exporter.getByRole('button', { name: 'Prepare export' }).click();
    const pendingWorkbook = exporter.waitForEvent('download');
    await exporter.getByRole('button', { name: 'Download Excel' }).click();
    const workbookDownload = await pendingWorkbook;
    expect(workbookDownload.suggestedFilename()).toMatch(/\.xlsx$/);
    await workbookDownload.saveAs(test.info().outputPath('linked-runs.xlsx'));
    const workbook = await JSZip.loadAsync(await readFile((await workbookDownload.path())!));
    expect(await workbook.file('xl/workbook.xml')!.async('string')).toContain('name="Export issues"');
    const runSummary = await workbook.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(runSummary).toContain('location="&apos;Run 1&apos;!A1"');
    expect(runSummary).toContain('location="&apos;Run 2&apos;!A1"');
    const stepSheet = await workbook.file('xl/worksheets/sheet3.xml')!.async('string');
    expect(stepSheet).toContain('available');
    expect(stepSheet).not.toContain('secure input sentinel');
  } finally {
    await context.close();
  }
});

test('exports from the popup and follows flow navigation in the side panel', async () => {
  const { context, extensionId } = await launchWithExtension();
  try {
    const makerOrigin = 'https://make.powerautomate.com';
    const makerPath = `/environments/${ENV_ID}/flows`;
    const maker = await context.newPage();
    await context.route(`${makerOrigin}${makerPath}/**`, route => route.fulfill({
      contentType: 'text/html',
      body: '<h1>Flow details</h1>',
    }));
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type,x-ms-client-request-id',
    };
    const token = 'Bearer ' + ['{}', JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })]
      .map(part => Buffer.from(part).toString('base64url')).join('.') + '.test';
    let startedAt = '';
    await context.route(`${flowApiHost}/**`, async route => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      const path = new URL(route.request().url()).pathname;
      const run = { name: 'inline-run', properties: { status: 'Succeeded', startTime: startedAt } };
      const json = path.endsWith('/runs') ? { value: [run] }
        : path.endsWith('/runs/inline-run') ? { ...run, properties: { ...run.properties, actions: {} } }
        : { properties: { displayName: path.endsWith(FLOW_B.id) ? FLOW_B.name : FLOW_A.name } };
      await route.fulfill({ json, headers: cors });
    });
    await maker.goto(`${makerOrigin}${makerPath}/${FLOW_A.id}/details`);

    // Chrome renders both surfaces from extension pages. Keep the maker tab
    // selected while exercising those documents in this test browser.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);
    await maker.bringToFront();
    await popup.getByRole('button', { name: 'Export runs' }).click();
    await expect(popup.getByRole('link', { name: 'Open Run history' })).toHaveAttribute('href',
      `${makerOrigin}${makerPath}/${FLOW_A.id}/runs`);
    await expect(popup.getByRole('button', { name: 'Prepare export' })).toBeDisabled();

    // Exercise the extension's actual token capture and delivery to an already open view.
    await maker.evaluate(async ({ url, token }) => {
      const response = await fetch(url, { headers: { authorization: token } });
      if (!response.ok) throw new Error('Mock portal request failed');
    }, { url: `${flowApiHost}${legacyPath.slice(0, -'/runs'.length)}`, token });
    await expect(popup.getByText(FLOW_A.name, { exact: true })).toBeVisible();
    startedAt = await popup.evaluate(() => new Date().toISOString());
    await popup.getByRole('button', { name: 'Prepare export' }).click();
    await expect(popup.getByText('1 run ready to download.')).toBeVisible();
    const [download] = await Promise.all([
      popup.waitForEvent('download'),
      popup.getByRole('button', { name: 'Download ZIP' }).click(),
    ]);
    const zip = await JSZip.loadAsync(await readFile((await download.path())!));
    expect(zip.file('runs/inline-run.json')).toBeTruthy();
    await popup.close();

    const sidebar = await context.newPage();
    await sidebar.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await maker.bringToFront();
    await sidebar.getByRole('button', { name: 'Export runs' }).click();
    await expect(sidebar.getByText(FLOW_A.name, { exact: true })).toBeVisible();
    await maker.evaluate(path => history.pushState({}, '', path), `${makerPath}/${FLOW_B.id}/details`);
    await expect(sidebar.getByText(FLOW_B.name, { exact: true })).toBeVisible();

    const otherMaker = await context.newPage();
    await otherMaker.goto(`${makerOrigin}${makerPath}/${FLOW_A.id}/details`);
    await otherMaker.bringToFront();
    await expect(sidebar.getByText(`Flow ${FLOW_A.id}`, { exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Prepare export' })).toBeDisabled();
    await maker.bringToFront();
    await expect(sidebar.getByText(FLOW_B.name, { exact: true })).toBeVisible();

    await maker.evaluate(path => history.pushState({}, '', path), makerPath);
    await expect(sidebar.getByText('Open a flow in Power Automate to export its runs.')).toBeVisible();
  } finally {
    await context.close();
  }
});
