import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { injectToken, launchWithExtension, mockFlowApi, openFlowEditor } from './fixtures/extension-helpers';
import { ENV_ID, FLOW_A, FAKE_TOKEN } from './fixtures/flow-data';

const DATAVERSE = 'https://pilot.crm.dynamics.com/api/data/v9.2/';
const WORKFLOW_ID = 'a1b2c3d4-0000-1111-2222-333344445555';
const OPERATION_ID = 'a1b2c3d4-0000-1111-2222-333344445556';
const JOB_ID = 'a1b2c3d4-0000-1111-2222-333344445557';
const CONNECTOR = '/providers/Microsoft.PowerApps/apis/shared_sharepointonline';

async function syntheticPackage() {
  const zip = new JSZip();
  zip.file('solution.xml', '<ImportExportXml><SolutionManifest><UniqueName>TestRelease</UniqueName><Version>1.2.0.0</Version><Managed>1</Managed></SolutionManifest></ImportExportXml>');
  zip.file('customizations.xml', `<ImportExportXml>
    <Workflows><Workflow WorkflowId="{${WORKFLOW_ID}}" Name="Example Flow"><JsonFileName>\\Workflows\\Pilot.json</JsonFileName><StateCode>0</StateCode></Workflow></Workflows>
    <connectionreferences><connectionreference connectionreferencelogicalname="test_site"><connectorid>${CONNECTOR}</connectorid></connectionreference></connectionreferences>
    </ImportExportXml>`);
  zip.file('environmentvariabledefinitions/test_dryrun/environmentvariabledefinition.xml',
    '<environmentvariabledefinition schemaname="test_dryrun"><displaynames><displayname description="Dry run" /></displaynames></environmentvariabledefinition>');
  zip.file('Workflows/Pilot.json', JSON.stringify({ properties: {
    connectionReferences: { shared_sharepointonline: { connection: { connectionReferenceLogicalName: 'test_site' } } },
    definition: { actions: { Update_list: { type: 'OpenApiConnection', inputs: {
      host: { apiId: CONNECTOR, connectionName: 'shared_sharepointonline' },
      parameters: { dataset: 'https://internal.example.invalid/sites/test', table: "@parameters('List')" },
    } } } },
  } }));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function openExport(page: Page) {
  await page.getByRole('menuitem', { name: 'More commands' }).or(page.getByRole('button', { name: 'More commands' })).first().click();
  await page.getByRole('menuitem', { name: 'Export managed solution' }).click();
  return page.getByRole('heading', { name: 'Export managed solution' });
}

test('reviews the generated solution before downloading the exact managed ZIP', async () => {
  const pilot = process.env.PA_MANAGED_PILOT_ZIP;
  const archive = pilot ? await readFile(pilot) : await syntheticPackage();
  const zip = await JSZip.loadAsync(archive);
  const solution = (await zip.file('solution.xml')!.async('text')).match(/<UniqueName>([^<]+)<\/UniqueName>/)![1];
  const workflowId = (await zip.file('customizations.xml')!.async('text')).match(/<Workflow WorkflowId="\{?([\w-]+)/i)![1];
  const requests: string[] = [];
  const { context, extensionId, serviceWorker } = await launchWithExtension();

  try {
    const page = await openFlowEditor(context, extensionId, ENV_ID, FLOW_A.id);
    await mockFlowApi(page, ENV_ID, FLOW_A.id, { ...FLOW_A.response, properties: { ...FLOW_A.response.properties, workflowEntityId: workflowId } });
    await page.route(`${DATAVERSE}**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const action = url.pathname.slice('/api/data/v9.2/'.length);
      requests.push(`${request.method()} ${action.split('(')[0]}`);
      if (action.startsWith('RetrieveCurrentOrganization(')) return route.fulfill({ json: { Detail: { EnvironmentId: ENV_ID } } });
      if (action === 'solutioncomponents') {
        expect(url.searchParams.get('$filter')).toContain(workflowId.toLowerCase());
        return route.fulfill({ json: { value: [
          { solutionid: { uniquename: 'Default', isvisible: true, ismanaged: false } },
          { solutionid: { uniquename: 'AlreadyManaged', isvisible: true, ismanaged: true } },
          { solutionid: { uniquename: solution, friendlyname: 'Pilot release', isvisible: true, ismanaged: false } },
        ] } });
      }
      if (action === 'ExportSolutionAsync') {
        expect(request.postDataJSON()).toEqual({ SolutionName: solution, Managed: true });
        return route.fulfill({ json: { AsyncOperationId: OPERATION_ID, ExportJobId: JOB_ID } });
      }
      if (action === `asyncoperations(${OPERATION_ID})`) return route.fulfill({ json: { statecode: 3, statuscode: 30 } });
      if (action === 'DownloadSolutionExportData') {
        expect(request.postDataJSON()).toEqual({ ExportJobId: JOB_ID });
        return route.fulfill({ json: { ExportSolutionFile: archive.toString('base64') } });
      }
      return route.fulfill({ status: 404 });
    });
    await injectToken(page, serviceWorker, { dataverseApiUrl: DATAVERSE, dataverseToken: FAKE_TOKEN });
    await expect(page.getByText(`Flow "${FLOW_A.name}" loaded successfully.`)).toBeVisible();
    await expect(await openExport(page)).toBeVisible();
    const downloadButton = page.getByRole('button', { name: 'Download managed ZIP' });
    await expect(downloadButton).toHaveCount(0);
    await page.getByRole('button', { name: 'Prepare export' }).click();
    await expect(page.getByRole('heading', { name: 'Connections to map' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fixed settings to review' })).toBeVisible();
    if (pilot) {
      await page.getByText('Included flows', { exact: true }).click();
      await expect(page.getByText(/· Off$/)).toBeVisible();
      await expect(page.getByText('2 additional references in the solution')).toBeVisible();
      await expect(page.getByText('Where used', { exact: true })).toHaveCount(4);
      await expect(page.getByText(/^Mailbox ·/)).toBeVisible();
      await expect(page.getByText(/^Excel workbook ·/)).toBeVisible();
      await expect(page.getByText(/^SharePoint site ·/)).toBeVisible();
      await expect(page.getByText(/^Embedded SharePoint URL ·/)).toBeVisible();
      await expect(page.getByText('No environment variables are packaged.')).toBeVisible();
    } else {
      await expect(page.getByText('Supply a value in the target environment.')).toBeVisible();
      await expect(page.getByText('https://internal.example.invalid/sites/test')).toHaveCount(0);
    }
    const settingsDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download blank deployment settings' }).click();
    const settings = JSON.parse(await readFile((await (await settingsDownload).path())!, 'utf8'));
    expect(settings.ConnectionReferences).toHaveLength(pilot ? 6 : 1);
    expect(settings.ConnectionReferences.every((binding: { ConnectionId: string }) => binding.ConnectionId === '')).toBe(true);
    expect(settings.EnvironmentVariables).toEqual(pilot ? [] : [{ SchemaName: 'test_dryrun', Value: '' }]);

    const zipDownload = page.waitForEvent('download');
    await downloadButton.click();
    const file = await zipDownload;
    expect(file.suggestedFilename()).toMatch(/_managed\.zip$/);
    expect((await readFile((await file.path())!)).equals(archive)).toBe(true);
    expect(requests).toEqual(['GET RetrieveCurrentOrganization', 'GET solutioncomponents', 'POST ExportSolutionAsync',
      'GET asyncoperations', 'POST DownloadSolutionExportData']);
  } finally {
    await context.close();
  }
});

test('reviews an existing ZIP from disk when Dataverse is unavailable', async () => {
  const { context, extensionId, serviceWorker } = await launchWithExtension();
  try {
    const page = await openFlowEditor(context, extensionId, ENV_ID, FLOW_A.id);
    await mockFlowApi(page, ENV_ID, FLOW_A.id, { ...FLOW_A.response, properties: { ...FLOW_A.response.properties, workflowEntityId: WORKFLOW_ID } });
    await injectToken(page, serviceWorker);
    await expect(page.getByText(`Flow "${FLOW_A.name}" loaded successfully.`)).toBeVisible();
    await expect(await openExport(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Prepare export' })).toHaveCount(0);
    await page.locator('input[aria-label="Existing solution ZIP"]').setInputFiles({
      name: 'test_managed.zip', mimeType: 'application/zip', buffer: await syntheticPackage(),
    });
    await expect(page.getByRole('heading', { name: 'Connections to map' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download blank deployment settings' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('maps the package to compatible connections in the target environment', async () => {
  const { context, extensionId, serviceWorker } = await launchWithExtension();
  try {
    const page = await openFlowEditor(context, extensionId, ENV_ID, FLOW_A.id);
    await mockFlowApi(page, ENV_ID, FLOW_A.id, FLOW_A.response);
    await page.route(`https://api.powerplatform.com/connectivity/environments/${ENV_ID}/connections?**`, route => route.fulfill({ json: {
      value: [
        { name: 'target-sharepoint', properties: { displayName: 'Target SharePoint', apiId: CONNECTOR } },
        { name: 'wrong-connector', properties: { displayName: 'Wrong connector', apiId: '/providers/Microsoft.PowerApps/apis/shared_office365' } },
      ],
    } }));
    await injectToken(page, serviceWorker, { powerPlatformApiUrl: 'https://api.powerplatform.com/', powerPlatformToken: FAKE_TOKEN });
    await expect(page.getByText(`Flow "${FLOW_A.name}" loaded successfully.`)).toBeVisible();
    await page.getByRole('menuitem', { name: 'More commands' }).or(page.getByRole('button', { name: 'More commands' })).first().click();
    await page.getByRole('menuitem', { name: 'Prepare solution import' }).click();
    await page.locator('input[aria-label="Solution ZIP to import"]').setInputFiles({
      name: 'test_managed.zip', mimeType: 'application/zip', buffer: await syntheticPackage(),
    });
    await expect(page.getByText('Target environment', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'test_site (test_site)' }).click();
    await expect(page.getByRole('option', { name: /Wrong connector/ })).toHaveCount(0);
    await page.getByRole('option', { name: /Target SharePoint/ }).click();
    await page.getByRole('textbox', { name: 'Dry run (test_dryrun)' }).fill('true');
    const file = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download deployment settings' }).click();
    expect(JSON.parse(await readFile((await (await file).path())!, 'utf8'))).toEqual({
      ConnectionReferences: [{ LogicalName: 'test_site', ConnectorId: CONNECTOR, ConnectionId: 'target-sharepoint' }],
      EnvironmentVariables: [{ SchemaName: 'test_dryrun', Value: 'true' }],
    });
  } finally {
    await context.close();
  }
});
