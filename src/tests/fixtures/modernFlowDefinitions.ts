// Realistic flow definitions in the shape Power Automate itself returns from
// GET .../flows/{id}?draftFlow=true (properties.definition). They exercise the
// operation types the designer emits today - OpenApiConnection and friends -
// which the stock Logic Apps workflowdefinition.json schema never listed.

const SCHEMA_URI =
  'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#';

const host = (connector: string, operationId: string) => ({
  connectionName: connector,
  operationId,
  apiId: `/providers/Microsoft.PowerApps/apis/${connector}`,
});

const meta = { operationMetadataId: '6f2b2f2c-6a5b-4e4b-9b8e-7c7b5c1f0a11' };

/** Every built-in and connector action type a modern flow commonly contains. */
const allActions = {
  Initialize_sStatus: {
    runAfter: {},
    metadata: meta,
    type: 'InitializeVariable',
    inputs: { variables: [{ name: 'sStatus', type: 'string', value: 'New' }] },
  },
  Initialize_aItems: {
    runAfter: { Initialize_sStatus: ['Succeeded'] },
    type: 'InitializeVariable',
    inputs: { variables: [{ name: 'aItems', type: 'array' }] },
  },
  Initialize_iCount: {
    runAfter: { Initialize_aItems: ['Succeeded'] },
    type: 'InitializeVariable',
    inputs: { variables: [{ name: 'iCount', type: 'integer', value: 0 }] },
  },
  Try: {
    runAfter: { Initialize_iCount: ['Succeeded'] },
    type: 'Scope',
    actions: {
      Get_items: {
        runAfter: {},
        metadata: meta,
        type: 'OpenApiConnection',
        inputs: {
          host: host('shared_sharepointonline', 'GetItems'),
          parameters: {
            dataset: 'https://contoso.sharepoint.com/sites/finance',
            table: '7a3d4c39-31a4-4e43-8f2d-3a1b6f0e9c11',
            $filter: "Status eq 'Pending'",
            $top: 500,
          },
          authentication: "@parameters('$authentication')",
          retryPolicy: { type: 'exponential', count: 4, interval: 'PT10S' },
        },
        runtimeConfiguration: {
          paginationPolicy: { minimumItemCount: 5000 },
          secureData: { properties: ['inputs', 'outputs'] },
        },
        description: 'Only items still waiting for review',
      },
      Filter_array: {
        runAfter: { Get_items: ['Succeeded'] },
        type: 'Query',
        inputs: {
          from: "@outputs('Get_items')?['body/value']",
          where: "@greater(item()?['Amount'], 1000)",
        },
      },
      Select_ids: {
        runAfter: { Filter_array: ['Succeeded'] },
        type: 'Select',
        inputs: { from: "@body('Filter_array')", select: { id: "@item()?['ID']", title: "@item()?['Title']" } },
      },
      Join_titles: {
        runAfter: { Select_ids: ['Succeeded'] },
        type: 'Join',
        inputs: { from: "@body('Select_ids')", joinWith: ', ' },
      },
      Create_HTML_table: {
        runAfter: { Join_titles: ['Succeeded'] },
        type: 'Table',
        inputs: { from: "@body('Select_ids')", format: 'HTML' },
      },
      Create_CSV_table: {
        runAfter: { Create_HTML_table: ['Succeeded'] },
        type: 'Table',
        inputs: {
          from: "@body('Select_ids')",
          format: 'CSV',
          columns: [{ header: 'Id', value: "@item()?['id']" }],
        },
      },
      Parse_JSON: {
        runAfter: { Create_CSV_table: ['Succeeded'] },
        type: 'ParseJson',
        inputs: {
          content: "@body('Get_items')",
          schema: { type: 'object', properties: { value: { type: 'array' } } },
        },
      },
      Compose_summary: {
        runAfter: { Parse_JSON: ['Succeeded'] },
        type: 'Compose',
        inputs: { count: "@length(body('Filter_array'))", titles: "@body('Join_titles')" },
      },
      Convert_time_zone: {
        runAfter: { Compose_summary: ['Succeeded'] },
        type: 'Expression',
        kind: 'ConvertTimeZone',
        inputs: {
          baseTime: '@{utcNow()}',
          formatString: 'g',
          sourceTimeZone: 'UTC',
          destinationTimeZone: 'W. Europe Standard Time',
        },
      },
      Current_time: {
        runAfter: { Convert_time_zone: ['Succeeded'] },
        type: 'Expression',
        kind: 'CurrentTime',
        inputs: {},
      },
      Apply_to_each: {
        foreach: "@body('Filter_array')",
        runAfter: { Current_time: ['Succeeded'] },
        type: 'Foreach',
        runtimeConfiguration: { concurrency: { repetitions: 10 } },
        actions: {
          Condition: {
            runAfter: {},
            type: 'If',
            expression: {
              and: [{ greater: ["@items('Apply_to_each')?['Amount']", 5000] }, { not: { equals: ["@items('Apply_to_each')?['Approved']", true] } }],
            },
            actions: {
              Start_and_wait_for_an_approval: {
                runAfter: {},
                type: 'OpenApiConnectionWebhook',
                inputs: {
                  host: host('shared_approvals', 'StartAndWaitForAnApproval'),
                  parameters: {
                    approvalType: 'Basic',
                    'WebhookApprovalCreationInput/title': "@{items('Apply_to_each')?['Title']}",
                    'WebhookApprovalCreationInput/assignedTo': 'finance@contoso.com',
                  },
                  authentication: "@parameters('$authentication')",
                },
                limit: { timeout: 'P7D' },
              },
              Increment_iCount: {
                runAfter: { Start_and_wait_for_an_approval: ['Succeeded'] },
                type: 'IncrementVariable',
                inputs: { name: 'iCount', value: 1 },
              },
            },
            else: {
              actions: {
                Append_to_aItems: {
                  runAfter: {},
                  type: 'AppendToArrayVariable',
                  inputs: { name: 'aItems', value: "@items('Apply_to_each')" },
                },
                Decrement_iCount: {
                  runAfter: { Append_to_aItems: ['Succeeded'] },
                  type: 'DecrementVariable',
                  inputs: { name: 'iCount', value: 1 },
                },
              },
            },
          },
        },
      },
      Switch_on_status: {
        runAfter: { Apply_to_each: ['Succeeded'] },
        type: 'Switch',
        expression: "@variables('sStatus')",
        cases: {
          Case_new: {
            case: 'New',
            actions: {
              Set_sStatus: {
                runAfter: {},
                type: 'SetVariable',
                inputs: { name: 'sStatus', value: 'Processed' },
              },
            },
          },
          Case_closed: {
            case: 'Closed',
            actions: {
              Append_to_string: {
                runAfter: {},
                type: 'AppendToStringVariable',
                inputs: { name: 'sStatus', value: ' (closed)' },
              },
            },
          },
        },
        default: { actions: {} },
      },
      Do_until: {
        actions: {
          Delay: {
            runAfter: {},
            type: 'Wait',
            inputs: { interval: { count: 1, unit: 'Minute' } },
          },
        },
        runAfter: { Switch_on_status: ['Succeeded'] },
        expression: "@equals(variables('iCount'), 0)",
        limit: { count: 60, timeout: 'PT1H' },
        type: 'Until',
      },
      HTTP: {
        runAfter: { Do_until: ['Succeeded'] },
        type: 'Http',
        inputs: {
          method: 'POST',
          uri: 'https://erp.contoso.com/api/invoices',
          headers: { 'Content-Type': 'application/json' },
          body: "@outputs('Compose_summary')",
          authentication: { type: 'Raw', value: "@{parameters('ErpKey')}" },
        },
        runtimeConfiguration: { contentTransfer: { transferMode: 'Chunked' } },
        operationOptions: 'DisableAsyncPattern',
      },
      Run_a_Child_Flow: {
        runAfter: { HTTP: ['Succeeded'] },
        type: 'Workflow',
        inputs: {
          host: { workflowReferenceName: '5c6d9a1e-2f0b-4e0c-9a61-0d3f9b7e2a10' },
          body: { text: "@{variables('sStatus')}" },
        },
      },
      Send_an_email: {
        runAfter: { Run_a_Child_Flow: ['Succeeded'] },
        type: 'OpenApiConnection',
        inputs: {
          host: host('shared_office365', 'SendEmailV2'),
          parameters: {
            'emailMessage/To': 'finance@contoso.com',
            'emailMessage/Subject': 'Invoices processed',
            'emailMessage/Body': "<p>@{body('Create_HTML_table')}</p>",
            'emailMessage/Importance': 'Normal',
          },
          authentication: "@parameters('$authentication')",
        },
      },
    },
  },
  Catch: {
    runAfter: { Try: ['Failed', 'TimedOut'] },
    type: 'Scope',
    actions: {
      Post_message_in_a_chat_or_channel: {
        runAfter: {},
        type: 'OpenApiConnection',
        inputs: {
          host: host('shared_teams', 'PostMessageToConversation'),
          parameters: {
            poster: 'Flow bot',
            location: 'Channel',
            'body/recipient/groupId': '0a1b2c3d',
            'body/messageBody': "<p>Run failed: @{workflow()?['run']?['name']}</p>",
          },
          authentication: "@parameters('$authentication')",
        },
      },
      Terminate: {
        runAfter: { Post_message_in_a_chat_or_channel: ['Succeeded', 'Skipped', 'Failed'] },
        type: 'Terminate',
        inputs: { runStatus: 'Failed', runError: { code: '500', message: "@{result('Try')}" } },
      },
    },
  },
  Response: {
    runAfter: { Try: ['Succeeded'] },
    type: 'Response',
    kind: 'Http',
    inputs: { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: { ok: true } },
  },
  Respond_to_a_PowerApp_or_flow: {
    runAfter: { Response: ['Succeeded'] },
    type: 'Response',
    kind: 'PowerApp',
    inputs: {
      statusCode: 200,
      body: { status: "@{variables('sStatus')}" },
      schema: { type: 'object', properties: { status: { title: 'status', 'x-ms-dynamically-added': true, type: 'string' } } },
    },
  },
};

const parameters = {
  $connections: { defaultValue: {}, type: 'Object' },
  $authentication: { defaultValue: {}, type: 'SecureObject' },
  'ErpKey (cr6a2_ErpKey)': {
    defaultValue: 'secret',
    type: 'String',
    metadata: { schemaName: 'cr6a2_ErpKey', description: 'ERP API key' },
  },
};

const definition = (triggers: Record<string, unknown>) => ({
  $schema: SCHEMA_URI,
  contentVersion: '1.0.0.0',
  parameters,
  triggers,
  actions: allActions,
});

/** Instant flow: "Manually trigger a flow" (Request / Button). */
export const manualTriggerFlow = definition({
  manual: {
    metadata: meta,
    type: 'Request',
    kind: 'Button',
    inputs: {
      schema: {
        type: 'object',
        properties: { text: { title: 'Input', type: 'string', 'x-ms-dynamically-added': true } },
        required: ['text'],
      },
    },
  },
});

/** Instant flow called from Power Apps (V2 trigger). */
export const powerAppTriggerFlow = definition({
  PowerAppV2: {
    type: 'Request',
    kind: 'PowerAppV2',
    inputs: { schema: { type: 'object', properties: {}, required: [] } },
  },
});

/** "When an HTTP request is received". */
export const httpRequestTriggerFlow = definition({
  manual: {
    type: 'Request',
    kind: 'Http',
    inputs: { method: 'POST', relativePath: 'invoices/{id}', schema: {} },
  },
});

/** Scheduled cloud flow. */
export const recurrenceFlow = definition({
  Recurrence: {
    recurrence: {
      frequency: 'Week',
      interval: 1,
      schedule: { weekDays: ['Monday', 'Thursday'], hours: ['8'], minutes: [30] },
      timeZone: 'W. Europe Standard Time',
      startTime: '2026-01-05T08:30:00Z',
    },
    metadata: meta,
    type: 'Recurrence',
  },
});

/** Automated flow: polling connector trigger with split-on and a trigger condition. */
export const pollingTriggerFlow = definition({
  When_an_item_is_created: {
    recurrence: { frequency: 'Minute', interval: 5 },
    splitOn: "@triggerOutputs()?['body/value']",
    conditions: [{ expression: "@equals(triggerBody()?['Status'], 'Pending')" }],
    metadata: meta,
    type: 'OpenApiConnection',
    inputs: {
      host: host('shared_sharepointonline', 'GetOnNewItems'),
      parameters: {
        dataset: 'https://contoso.sharepoint.com/sites/finance',
        table: '7a3d4c39-31a4-4e43-8f2d-3a1b6f0e9c11',
      },
      authentication: "@parameters('$authentication')",
    },
  },
});

/** Automated flow: webhook connector trigger (Teams). */
export const webhookTriggerFlow = definition({
  When_a_new_channel_message_is_added: {
    type: 'OpenApiConnectionWebhook',
    inputs: {
      host: host('shared_teams', 'WebhookNewMessageTrigger'),
      parameters: { groupId: '0a1b2c3d', channelId: '19:abc@thread.tacv2' },
      authentication: "@parameters('$authentication')",
    },
    splitOn: "@triggerOutputs()?['body/value']",
  },
});

/** Automated flow: notification connector trigger (Outlook "When a new email arrives (V3)"). */
export const notificationTriggerFlow = definition({
  When_a_new_email_arrives_V3: {
    type: 'OpenApiConnectionNotification',
    inputs: {
      host: host('shared_office365', 'OnNewEmailV3'),
      parameters: { folderPath: 'Inbox', importance: 'Any', fetchOnlyWithAttachment: false, includeAttachments: false },
      authentication: "@parameters('$authentication')",
    },
    splitOn: "@triggerOutputs()?['body/value']",
  },
});

export const modernFlowDefinitions: Record<string, unknown> = {
  manualTriggerFlow,
  powerAppTriggerFlow,
  httpRequestTriggerFlow,
  recurrenceFlow,
  pollingTriggerFlow,
  webhookTriggerFlow,
  notificationTriggerFlow,
};
