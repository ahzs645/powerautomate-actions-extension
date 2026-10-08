import {
    classifyApiUrl,
    extractEnvIdFromTabUrl,
    extractFlowDataFromApiUrl,
    extractFlowDataFromTabUrl,
    extractWorkflowEntityId,
    isMakerHost,
    isMakerOrigin,
} from '../../chrome/hosts';

const ENV = 'Default-11111111-2222-3333-4444-555555555555';
const FLOW = '6e2f407e-6cb2-e570-8bce-2be05952c2f6';
const WF = 'a1b2c3d4-0000-1111-2222-333344445555';

describe('isMakerHost', () => {
    test.each([
        'make.powerautomate.com',
        'make.powerapps.com',
        'make.preview.powerautomate.com',
        'flow.microsoft.com',
        'emea.flow.microsoft.com',
        'make.gov.powerautomate.us',
        'make.high.powerautomate.us',
        'make.powerautomate.appsplatform.us',
        'make.gov.powerapps.us',
        'make.high.powerapps.us',
        'make.apps.appsplatform.us',
        'gov.flow.microsoft.us',
        'high.flow.microsoft.us',
        'flow.appsplatform.us',
    ])('%s is a maker host', (host) => {
        expect(isMakerHost(host)).toBe(true);
    });

    test.each([
        'api.flow.microsoft.com',
        'unitedstates.api.flow.microsoft.com',
        'gov.api.flow.microsoft.us',
        'contoso.crm.dynamics.com',
        'contoso.sharepoint.com',
        'evil-make.powerautomate.com.attacker.net',
        'powerautomate.com.evil.io',
        '',
    ])('%s is not a maker host', (host) => {
        expect(isMakerHost(host)).toBe(false);
    });

    test('isMakerOrigin requires https', () => {
        expect(isMakerOrigin('https://make.powerautomate.com')).toBe(true);
        expect(isMakerOrigin('http://make.powerautomate.com')).toBe(false);
        expect(isMakerOrigin(undefined)).toBe(false);
        expect(isMakerOrigin('not a url')).toBe(false);
    });
});

describe('classifyApiUrl', () => {
    test.each([
        ['https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/x/flows', 'flow', 'https://api.flow.microsoft.com/', 2],
        ['https://unitedstates.api.flow.microsoft.com/providers/x', 'flow', 'https://unitedstates.api.flow.microsoft.com/', 2],
        ['https://gov.api.flow.microsoft.us/providers/x', 'flow', 'https://gov.api.flow.microsoft.us/', 2],
        ['https://high.api.flow.microsoft.us/providers/x', 'flow', 'https://high.api.flow.microsoft.us/', 2],
        ['https://api.flow.appsplatform.us/providers/x', 'flow', 'https://api.flow.appsplatform.us/', 2],
        ['https://emea.api.powerautomate.com/x', 'flow', 'https://emea.api.powerautomate.com/', 1],
        ['https://6e2f407e6cb2e5708bce2be05952c2.f6.environment.api.powerplatform.com/powerautomate/flows/x', 'powerPlatform', 'https://6e2f407e6cb2e5708bce2be05952c2.f6.environment.api.powerplatform.com/', 2],
        ['https://api.powerplatform.com/powerautomate/x', 'powerPlatform', 'https://api.powerplatform.com/', 1],
        ['https://abc.environment.api.gov.powerplatform.microsoft.us/powerautomate/x', 'powerPlatform', 'https://abc.environment.api.gov.powerplatform.microsoft.us/', 2],
        ['https://unitedstates.api.powerapps.com/providers/x', 'powerApps', 'https://unitedstates.api.powerapps.com/', 1],
        ['https://usgovhigh.api.powerapps.us/providers/x', 'powerApps', 'https://usgovhigh.api.powerapps.us/', 1],
        ['https://contoso.crm.dynamics.com/api/data/v9.2/workflows?$top=1', 'dataverse', 'https://contoso.crm.dynamics.com/api/data/v9.2/', 1],
        ['https://contoso.crm4.dynamics.com/api/data/v9.1/systemusers', 'dataverse', 'https://contoso.crm4.dynamics.com/api/data/v9.1/', 1],
        ['https://contoso.crm9.dynamics.com/api/data/v9.2/x', 'dataverse', 'https://contoso.crm9.dynamics.com/api/data/v9.2/', 1],
        ['https://contoso.crm.microsoftdynamics.us/api/data/v9.2/x', 'dataverse', 'https://contoso.crm.microsoftdynamics.us/api/data/v9.2/', 1],
        ['https://contoso.crm.appsplatform.us/api/data/v9.2/x', 'dataverse', 'https://contoso.crm.appsplatform.us/api/data/v9.2/', 1],
    ])('%s → %s', (url, audience, baseUrl, rank) => {
        expect(classifyApiUrl(url)).toEqual(expect.objectContaining({ audience, baseUrl, rank }));
    });

    test.each([
        'https://contoso.crm.dynamics.com/main.aspx?appid=1',   // Dynamics app page, not the Web API
        'https://contoso.crm.dynamics.com/WebResources/x.js',
        'https://graph.microsoft.com/v1.0/me',
        'https://contoso.sharepoint.com/_api/web',
        'http://api.flow.microsoft.com/x',
        'nonsense',
    ])('%s is ignored', (url) => {
        expect(classifyApiUrl(url)).toBeNull();
    });
});

describe('extractWorkflowEntityId', () => {
    test('reads workflows(<guid>) from Dataverse URLs', () => {
        expect(extractWorkflowEntityId(`https://contoso.crm.dynamics.com/api/data/v9.2/workflows(${WF})?$select=clientdata`)).toBe(WF);
        expect(extractWorkflowEntityId(`https://contoso.crm.dynamics.com/api/data/v9.0/workflows(${WF.toUpperCase()})`)).toBe(WF);
        expect(extractWorkflowEntityId(`https://contoso.crm.microsoftdynamics.us/api/data/v9.2/workflows(workflowid=${WF})`)).toBe(WF);
    });
    test('ignores other tables and hosts', () => {
        expect(extractWorkflowEntityId(`https://contoso.crm.dynamics.com/api/data/v9.2/accounts(${WF})`)).toBeNull();
        expect(extractWorkflowEntityId(`https://api.flow.microsoft.com/api/data/v9.2/workflows(${WF})`)).toBeNull();
        expect(extractWorkflowEntityId('https://contoso.crm.dynamics.com/api/data/v9.2/workflows')).toBeNull();
    });
});

describe('maker page URL parsing (commercial + government clouds)', () => {
    test.each([
        'https://make.powerautomate.com',
        'https://make.gov.powerautomate.us',
        'https://make.high.powerautomate.us',
        'https://make.powerautomate.appsplatform.us',
        'https://make.powerapps.com',
    ])('%s flow and list URLs', (origin) => {
        expect(extractFlowDataFromTabUrl(`${origin}/environments/${ENV}/flows/${FLOW}/details`)).toEqual({ envId: ENV, flowId: FLOW });
        expect(extractFlowDataFromTabUrl(`${origin}/environments/${ENV}/solutions/fd140aaf-4df4-11dd-bd17-0019b9312238/flows/${FLOW}`)).toEqual({ envId: ENV, flowId: FLOW });
        expect(extractFlowDataFromTabUrl(`${origin}/environments/${ENV}/flows`)).toBeNull();
        expect(extractEnvIdFromTabUrl(`${origin}/environments/${ENV}/flows`)).toBe(ENV);
    });

    test('flow ids in query strings and encoded URLs', () => {
        expect(extractFlowDataFromTabUrl(`https://make.powerautomate.com/environments/${ENV}/flows/shared/${FLOW}`)).toEqual({ envId: ENV, flowId: FLOW });
        expect(extractFlowDataFromTabUrl(`https://make.powerautomate.com/environments/${ENV}/flows/${FLOW.replace(/-/g, '%2D')}`)).toEqual({ envId: ENV, flowId: FLOW });
        expect(extractFlowDataFromTabUrl(`https://make.powerautomate.com/environments/${ENV}/x?flowId=${FLOW}`)).toEqual({ envId: ENV, flowId: FLOW });
    });

    test('extractFlowDataFromApiUrl handles commercial and government Flow API paths', () => {
        const path = `/providers/Microsoft.ProcessSimple/environments/${ENV}/flows/${FLOW}?api-version=2016-11-01`;
        ['https://api.flow.microsoft.com', 'https://gov.api.flow.microsoft.us', 'https://high.api.flow.microsoft.us', 'https://api.flow.appsplatform.us']
            .forEach((host) => expect(extractFlowDataFromApiUrl(host + path)).toEqual({ envId: ENV, flowId: FLOW }));
        expect(extractFlowDataFromApiUrl(`https://x.environment.api.powerplatform.com/powerautomate/environments/${ENV}/flows/${FLOW}`)).toEqual({ envId: ENV, flowId: FLOW });
        expect(extractFlowDataFromApiUrl('https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments')).toBeNull();
    });
});
