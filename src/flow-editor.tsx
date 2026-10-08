import { initializeIcons } from '@fluentui/react/lib/Icons';
import { Stack } from '@fluentui/react/lib/Stack';
import { ThemeProvider } from '@fluentui/react/lib/Theme';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import './theme/tokens.css';
import { getFluentTheme } from './theme/fluentTheme';
import { useResolvedTheme } from './theme/useResolvedTheme';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { NavBar } from './components/shared/NavBar';
import {
  ApiProviderContext,
  ApiProviderContextRoot
} from './services/ApiProvider';
import { FlowsListPage } from './features/flows-list/FlowsListPage';
import { BlockedState } from './features/flow-editor/components/BlockedState';
import { lazy, Suspense, useEffect, useState } from 'react';

// Monaco, the JSON schemas and the precompiled validator live in this chunk, which
// is only fetched once a flow is actually opened.
const FlowEditorPage = lazy(
  () => import(/* webpackChunkName: "flow-editor-page" */ './features/flow-editor/FlowEditorPage')
);

/** How long to wait for the Power Automate tab to hand over a sign-in token. */
const AUTH_TIMEOUT_MS = 30000;
const POWER_AUTOMATE_URL = 'https://make.powerautomate.com/';

// Initialize icons (suppress warnings if already registered)
initializeIcons(undefined, { disableWarnings: true });

mergeStyles({
  ':global(body,html,#flow-editor-root)': {
    margin: 0,
    padding: 0,
    height: '100vh',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-fg)',
  },
});

const root = document.getElementById('flow-editor-root');
if (root) {
  createRoot(root).render(<App />);
}

type AuthProblem = 'missing-params' | 'timeout' | null;

function App() {
  const apiProviderRoot = ApiProviderContextRoot();
  const resolvedTheme = useResolvedTheme();
  const [authProblem, setAuthProblem] = useState<AuthProblem>(null);

  const urlParams = new URLSearchParams(window.location.search);
  const envId = urlParams.get('envId');
  const flowId = urlParams.get('flowId');
  // An envId on its own means "show every flow in this environment"; adding a
  // flowId opens that one flow in the JSON editor.
  const isFlowsList = Boolean(envId) && !flowId;

  useEffect(() => {
    if (!envId) {
      setAuthProblem('missing-params');
      return;
    }
    if (apiProviderRoot.isApiReady) {
      setAuthProblem(null);
      return;
    }
    const timeout = setTimeout(() => setAuthProblem('timeout'), AUTH_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [apiProviderRoot.isApiReady, envId]);

  useEffect(() => {
    if (authProblem === 'missing-params') document.title = 'Open a flow — Power Automate Toolkit';
    else if (authProblem === 'timeout') document.title = 'Not connected — Power Automate Toolkit';
    else if (!apiProviderRoot.isApiReady) document.title = 'Connecting… — Power Automate Toolkit';
  }, [authProblem, apiProviderRoot.isApiReady]);

  const reload = () => window.location.reload();

  let content: JSX.Element;
  if (authProblem === 'missing-params') {
    content = (
      <BlockedState
        icon="OpenInNewWindow"
        title="Open this from a flow in Power Automate"
        actions={[{ text: 'Open Power Automate', href: POWER_AUTOMATE_URL, primary: true }]}
      >
        <p>
          This page edits one flow, so it needs to know which one. In Power Automate, open the flow's
          details or edit page, then select the Power Automate Toolkit icon and choose{' '}
          <strong>Edit flow JSON</strong> (or <strong>All flows</strong> for the list of flows in that
          environment).
        </p>
      </BlockedState>
    );
  } else if (authProblem === 'timeout') {
    content = (
      <BlockedState
        icon="PlugDisconnected"
        title="Couldn't connect to Power Automate"
        actions={[
          { text: 'Retry', onClick: reload, primary: true },
          { text: 'Open Power Automate', href: POWER_AUTOMATE_URL },
        ]}
      >
        <p>
          The toolkit did not receive a sign-in token within {AUTH_TIMEOUT_MS / 1000} seconds. It borrows
          the token from an open Power Automate tab.
        </p>
        <ol>
          <li>Make sure a Power Automate tab is open and you are signed in.</li>
          <li>Reload that tab so the toolkit can capture a fresh token.</li>
          <li>Come back here and select Retry.</li>
        </ol>
      </BlockedState>
    );
  } else if (!apiProviderRoot.isApiReady) {
    content = (
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
    );
  } else {
    content = (
      <Routes>
        <Route path="/">
          <Route
            index
            element={
              isFlowsList ? (
                <FlowsListPage />
              ) : (
                <Suspense
                  fallback={
                    <Stack verticalAlign="center" styles={{ root: { flex: 1 } }}>
                      <Spinner size={SpinnerSize.large} label="Loading editor…" />
                    </Stack>
                  }
                >
                  <FlowEditorPage />
                </Suspense>
              )
            }
          />
        </Route>
      </Routes>
    );
  }

  return (
    <HashRouter>
      <ThemeProvider
        theme={getFluentTheme(resolvedTheme)}
        style={{ height: '100%', backgroundColor: 'var(--color-bg)' }}
      >
        <ApiProviderContext.Provider value={apiProviderRoot}>
          <Stack styles={{ root: { height: '100%', minHeight: 0 } }}>
            <NavBar />
            {content}
          </Stack>
        </ApiProviderContext.Provider>
      </ThemeProvider>
    </HashRouter>
  );
}
