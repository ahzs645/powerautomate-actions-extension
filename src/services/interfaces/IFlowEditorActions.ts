export interface RefreshInitiator {
  type: 'refresh';
}

export interface AppLoaded {
  type: 'app-loaded';
}

export interface TokenChanged {
  type: 'token-changed';
  token: string;
  apiUrl: string;
}

export interface OpenFlowEditor {
  type: 'open-flow-editor';
  envId: string;
  flowId: string;
}

export interface CheckFlowPage {
  type: 'check-flow-page';
}

export interface FlowPageStatus {
  type: 'flow-page-status';
  isFlowPage: boolean;
  envId?: string;
  flowId?: string;
}

export type FlowEditorActions =
  | RefreshInitiator
  | TokenChanged
  | AppLoaded
  | OpenFlowEditor
  | CheckFlowPage
  | FlowPageStatus;
