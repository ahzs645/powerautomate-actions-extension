/**
 * Mock flow data for E2E tests.
 * These simulate the Power Automate API responses.
 */

export const ENV_ID = '6e2f407e-6cb2-e570-8bce-2be05952c2f6';

export const FLOW_A = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Test Flow A - Approval Process',
  response: {
    name: '11111111-1111-1111-1111-111111111111',
    id: `/providers/Microsoft.ProcessSimple/environments/${ENV_ID}/flows/11111111-1111-1111-1111-111111111111`,
    type: 'Microsoft.ProcessSimple/environments/flows',
    properties: {
      displayName: 'Test Flow A - Approval Process',
      environment: {
        name: ENV_ID,
        type: 'Microsoft.ProcessSimple/environments',
        id: `/providers/Microsoft.ProcessSimple/environments/${ENV_ID}`,
      },
      definition: {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0.0',
        triggers: {
          manual: {
            type: 'Request',
            kind: 'Button',
            inputs: { schema: {} },
          },
        },
        actions: {
          'Send_an_email': {
            type: 'ApiConnection',
            inputs: {
              host: { connectionName: 'shared_office365' },
              method: 'post',
              path: '/v2/Mail',
              body: {
                To: 'test@example.com',
                Subject: 'Approval needed',
                Body: 'Please review.',
              },
            },
            runAfter: {},
          },
        },
      },
      connectionReferences: {
        shared_office365: {
          connectionName: 'shared-office365-abc',
          source: 'Invoker',
          id: '/providers/Microsoft.PowerApps/apis/shared_office365',
          displayName: 'Office 365 Outlook',
        },
      },
    },
  },
};

export const FLOW_B = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Test Flow B - Data Sync',
  response: {
    name: '22222222-2222-2222-2222-222222222222',
    id: `/providers/Microsoft.ProcessSimple/environments/${ENV_ID}/flows/22222222-2222-2222-2222-222222222222`,
    type: 'Microsoft.ProcessSimple/environments/flows',
    properties: {
      displayName: 'Test Flow B - Data Sync',
      environment: {
        name: ENV_ID,
        type: 'Microsoft.ProcessSimple/environments',
        id: `/providers/Microsoft.ProcessSimple/environments/${ENV_ID}`,
      },
      definition: {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0.0',
        triggers: {
          'When_an_item_is_created': {
            type: 'ApiConnectionWebhook',
            inputs: {
              host: { connectionName: 'shared_sharepointonline' },
              method: 'post',
              path: '/datasets/{siteUrl}/tables/{listName}/onnewitems',
            },
          },
        },
        actions: {
          'Update_item': {
            type: 'ApiConnection',
            inputs: {
              host: { connectionName: 'shared_sharepointonline' },
              method: 'patch',
              path: '/datasets/{siteUrl}/tables/{listName}/items/{id}',
            },
            runAfter: {},
          },
        },
      },
      connectionReferences: {
        shared_sharepointonline: {
          connectionName: 'shared-sharepointonline-xyz',
          source: 'Invoker',
          id: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
          displayName: 'SharePoint',
        },
      },
    },
  },
};

/** Minimal JWT token for testing (expired, but structure is valid) */
export function makeFakeJwt(expiresInSeconds = 3600): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      aud: 'https://service.flow.microsoft.com/',
      iss: 'https://sts.windows.net/test-tenant/',
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
      iat: Math.floor(Date.now() / 1000),
      sub: 'test-user',
    })
  );
  const signature = btoa('fake-signature');
  return `Bearer ${header}.${payload}.${signature}`;
}

export const FAKE_TOKEN = makeFakeJwt();
export const API_HOST = 'https://unitedstates.api.powerapps.com';

/** Build the PA flow page URL that the extension parses envId/flowId from */
export function flowPageUrl(envId: string, flowId: string): string {
  return `https://make.powerautomate.com/environments/${envId}/flows/${flowId}/details`;
}

/** API path the flow editor fetches */
export function flowApiPath(envId: string, flowId: string): string {
  return `providers/Microsoft.ProcessSimple/environments/${envId}/flows/${flowId}`;
}
