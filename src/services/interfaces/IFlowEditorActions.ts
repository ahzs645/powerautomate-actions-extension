export interface RefreshInitiator {
  type: 'refresh';
}

export interface AppLoaded {
  type: 'app-loaded';
}

/** Token audiences captured per Power Automate tab by the background worker. */
export type TokenAudience = 'flow' | 'powerPlatform' | 'dataverse' | 'powerApps';

export interface TokenChanged {
  type: 'token-changed';
  /** Primary pair (env-scoped Power Platform > Flow API > tenant Power Platform > Power Apps). */
  token: string;
  apiUrl: string;
  /** Flow (ProcessSimple) API — api.flow.microsoft.com and regional/gov variants. */
  legacyApiUrl?: string;
  legacyToken?: string;
  /** Power Platform API (*.api.powerplatform.com /powerautomate/). */
  powerPlatformApiUrl?: string;
  powerPlatformToken?: string;
  /** Dataverse Web API root, e.g. https://org.crm.dynamics.com/api/data/v9.2/ */
  dataverseApiUrl?: string;
  dataverseToken?: string;
  /** Dataverse workflow id of the open flow, when known. */
  workflowEntityId?: string;
  /** Token expiry per audience, epoch ms. */
  expiresAt?: Partial<Record<TokenAudience, number>>;
}

/** Editor → background: remember the Dataverse workflow id (from flow GET properties.workflowEntityId). */
export interface SetWorkflowEntityId {
  type: 'set-workflow-entity-id';
  workflowEntityId: string;
  flowId?: string;
}

/** Extension page → background: sanitised diagnostics text. Response: { text: string }. */
export interface GetDiagnostics {
  type: 'get-diagnostics';
}

/** Extension page → background: record a diagnostics event (re-sanitised in the background). */
export interface DiagnosticsEventMessage {
  type: 'diagnostics-event';
  event: Record<string, unknown>;
}

/**
 * Popup → background: inject the content script into the active tab on demand
 * (activeTab), for pages outside the declared content_scripts matches such as
 * community blogs. Response: { success: boolean; injected?: boolean; error?: string }.
 */
export interface EnsureContentScript {
  type: 'ensure-content-script';
}

/** Popup/settings → background: { extensionEnabled, showDesignerButton }. */
export interface GetPlatformStatus {
  type: 'get-platform-status';
}

export interface OpenFlowEditor {
  type: 'open-flow-editor';
  envId: string;
  flowId: string;
}

export interface OpenFlowsList {
  type: 'open-flows-list';
}

export interface CheckFlowPage {
  type: 'check-flow-page';
}

export interface FlowPageStatus {
  type: 'flow-page-status';
  isFlowPage: boolean;
  /** True on any Power Automate page that identifies an environment, flow page or not. */
  isEnvironmentPage?: boolean;
  envId?: string;
  flowId?: string;
}

export type FlowEditorActions =
  | RefreshInitiator
  | TokenChanged
  | AppLoaded
  | OpenFlowEditor
  | OpenFlowsList
  | CheckFlowPage
  | FlowPageStatus
  | SetWorkflowEntityId
  | GetDiagnostics
  | DiagnosticsEventMessage
  | EnsureContentScript
  | GetPlatformStatus;
