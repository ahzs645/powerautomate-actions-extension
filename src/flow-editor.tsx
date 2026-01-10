import { initializeIcons } from '@fluentui/react/lib/Icons';
import { Stack } from '@fluentui/react/lib/Stack';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { NavBar } from './components/shared/NavBar';
import {
  ApiProviderContext,
  ApiProviderContextRoot
} from './services/ApiProvider';
import { FlowEditorPage } from './features/flow-editor/FlowEditorPage';
import { useEffect, useState } from 'react';

// Import schemas
import workflowDefinitionSchema from './schemas/workflowdefinition.json';
import flowEditorSchema from './schemas/flow-editor.json';

initMonaco();

// Initialize icons (suppress warnings if already registered)
initializeIcons(undefined, { disableWarnings: true });

mergeStyles({
  ':global(body,html,#flow-editor-root)': {
    margin: 0,
    padding: 0,
    height: '100vh',
  },
});

const root = document.getElementById('flow-editor-root');
if (root) {
  createRoot(root).render(<App />);
}

function App() {
  const apiProviderRoot = ApiProviderContextRoot();
  const [isWaitingForAuth, setIsWaitingForAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const urlParams = new URLSearchParams(window.location.search);
  const envId = urlParams.get('envId');
  const flowId = urlParams.get('flowId');

  useEffect(() => {
    if (!envId || !flowId) {
      setAuthError('Invalid URL parameters. Please open the extension from a Power Automate flow page.');
      setIsWaitingForAuth(false);
      return;
    }

    const timeout = setTimeout(() => {
      if (!apiProviderRoot.isApiReady) {
        setAuthError('Authentication timeout. Please refresh the Power Automate page and try again.');
        setIsWaitingForAuth(false);
      }
    }, 30000);

    if (apiProviderRoot.isApiReady) {
      setIsWaitingForAuth(false);
      setAuthError(null);
      clearTimeout(timeout);
    }

    return () => clearTimeout(timeout);
  }, [apiProviderRoot.isApiReady, envId, flowId]);

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <HashRouter>
      <ApiProviderContext.Provider value={apiProviderRoot}>
        <Stack
          styles={{
            root: {
              height: '100%',
            },
          }}
        >
          <NavBar />

          {authError && (
            <MessageBar
              messageBarType={MessageBarType.error}
              isMultiline={false}
              onDismiss={() => setAuthError(null)}
              actions={
                <div>
                  <button onClick={handleRefresh}>Refresh</button>
                </div>
              }
            >
              {authError}
            </MessageBar>
          )}

          {isWaitingForAuth && !authError ? (
            <Stack
              horizontalAlign="center"
              verticalAlign="center"
              styles={{ root: { flex: 1, padding: 20 } }}
            >
              <Spinner size={SpinnerSize.large} />
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <h3>Connecting to Power Automate...</h3>
                <p>Please make sure you have an active Power Automate session.</p>
                <p>If this takes too long, try refreshing the Power Automate page first.</p>
              </div>
            </Stack>
          ) : apiProviderRoot.isApiReady && !authError ? (
            <Routes>
              <Route path="/">
                <Route index element={<FlowEditorPage />} />
              </Route>
            </Routes>
          ) : !authError ? (
            <Stack
              horizontalAlign="center"
              verticalAlign="center"
              styles={{ root: { flex: 1, padding: 20 } }}
            >
              <h2>Please refresh the flow's details/edit tab first.</h2>
              <p>To use this extension:</p>
              <ol>
                <li>Go to your Power Automate flow</li>
                <li>Click on the flow to open it</li>
                <li>Navigate to the flow details or edit page</li>
                <li>Click the extension icon again</li>
              </ol>
            </Stack>
          ) : null}
        </Stack>
      </ApiProviderContext.Provider>
    </HashRouter>
  );
}

function initMonaco() {
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    enableSchemaRequest: true,
    schemas: [
      {
        uri: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json',
        schema: workflowDefinitionSchema,
      },
      {
        uri: 'https://power-automate-toolkit.local/flow-editor.json',
        schema: flowEditorSchema,
        fileMatch: ['*']
      },
    ],
  });

  loader.config({
    monaco: monaco,
  });
}
