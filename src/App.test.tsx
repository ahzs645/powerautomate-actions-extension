import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import App from './App';
import { ActionType, Mode } from './models';

describe('App', () => {
  let storageServiceMock: any;
  let actionsServiceMock: any;
  let communicationServiceMock: any;

  const mockChrome = {
    storage: {
      local: {
        get: jest.fn().mockImplementation((key) => {
          switch (key) {
            case 'RECORDED_ACTIONS_KEY': return [];
            case 'MY_CLIPBOARD_ACTIONS_KEY': return [];
            case 'IS_RECORDING_KEY': true;
          }
        }
        ),
        set: jest.fn(),
      },
    },
    tabs: {
      query: jest.fn(),
      sendMessage: jest.fn(),
    },
    runtime: {
      sendMessage: jest.fn(),
      onMessage: {
        addListener: jest.fn(),
        removeListener: jest.fn()
      }
    },
  };

  beforeEach(() => {
    global['chrome'] = mockChrome as any;

    storageServiceMock = {
      getIsRecordingValue: jest.fn().mockImplementation(() => { return true; }),
      setIsRecordingValue: jest.fn().mockImplementation((value) => { return value; }),
      deleteAction: jest.fn().mockImplementation((message) => { }),
      deleteMyClipboardAction: jest.fn().mockImplementation((message) => { }),
      setNewAction: jest.fn().mockImplementation((value) => { return value; }),
      getActions: jest.fn().mockImplementation(() => { return []; }),
    }

    actionsServiceMock = {
      getTitleFromUrl: jest.fn().mockImplementation((url) => { return 'Example'; }),
      getHttpSharePointActionTemplate: jest.fn(),
      getHttpRequestActionTemplate: jest.fn(),

    };


    jest.mock('./services/StorageService');
    jest.mock('./services/ActionsService');
    communicationServiceMock = jest.mock('./services/ExtensionCommunicationService', () => {
      return jest.fn().mockImplementation(() => ({
        sendRequest: jest.fn(),
      }));
    });

  });

  const renderPage = (overrides: Partial<React.ComponentProps<typeof App>> = {}) => render(<App isRecording={false}
      isPowerAutomatePage={false}
      isRecordingPage={false}
      hasActionsOnPageToCopy={false}
      actions={[]}
      myClipboardActions={[]}
      currentMode={Mode.Requests}
      favoriteActions={[]}
      {...overrides}
      />);

  test('renders the app title, a labelled primary area and the tabs', () => {
    renderPage({ isRecordingPage: true });

    expect(screen.getByText('Power Automate Toolkit')).toBeInTheDocument();
    // Not on a flow: the primary actions stay visible but disabled, with a hint.
    expect(screen.getByRole('button', { name: /Edit flow JSON/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: /Browse flows/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Open a flow in Power Automate')).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Recorded/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Copied/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Favorites/ })).toBeInTheDocument();
  });

  test('renders header controls as named buttons, not clickable icons', () => {
    renderPage({ isRecordingPage: true });

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch to (dark|light) mode/ })).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access
    const headerIcons = Array.from(document.querySelectorAll('.App-header [data-icon-name]'));
    expect(headerIcons.length).toBeGreaterThan(0);
    // eslint-disable-next-line testing-library/no-node-access
    headerIcons.forEach(icon => expect(icon.closest('button')).not.toBeNull());
  });

  test('renders no empty notification band', () => {
    renderPage({ isRecordingPage: true });
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.querySelector('.ms-MessageBar')).toBeNull();
  });

  test('renders App component with correct buttons for SharePointPage', async () => {
    renderPage({ isRecordingPage: true });

    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
    expect(screen.getByText('SharePoint page')).toBeInTheDocument();
    // Clear lives with the list now and needs something to clear.
    expect(screen.queryByRole('button', { name: /Clear all/ })).not.toBeInTheDocument();
  });

  test('renders App component with correct buttons for SharePointPage while recording', async () => {
    renderPage({ isRecordingPage: true, isRecording: true });

    const stop = screen.getByRole('button', { name: 'Stop recording' });
    expect(stop).toHaveClass('recording-active');
    const status = screen.getAllByRole('status').find(el => el.classList.contains('recording-status'));
    expect(status).toHaveTextContent('Recording…');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  test('renders App component with correct buttons for Power Automate page', async () => {
    renderPage({ isPowerAutomatePage: true });

    expect(screen.getByRole('button', { name: 'Get actions from My Clipboard (classic designer)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy to My Clipboard (classic designer)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start recording' })).not.toBeInTheDocument();
    expect(screen.getByText('Power Automate')).toBeInTheDocument();
  });

  test('renders App component with correct buttons for Blog page', async () => {
    renderPage({ hasActionsOnPageToCopy: true });

    expect(screen.getByRole('button', { name: 'Copy all actions from this page' })).toBeInTheDocument();
    expect(screen.getByText('Page with actions')).toBeInTheDocument();
  });

  test('opens Settings in place of the tabs and comes back with Back', async () => {
    renderPage({ currentMode: Mode.Settings });

    act(() => {
      screen.getByRole('button', { name: 'Settings' }).click();
    });

    expect(await screen.findByRole('heading', { name: 'Settings', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'Back to actions' }).click();
    });
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  test('shows a how-to when the Recorded list is empty', () => {
    renderPage({ isRecordingPage: true });
    expect(screen.getByText('No recorded requests yet')).toBeInTheDocument();
    expect(screen.getByText('Click Record, then use SharePoint — requests appear here.')).toBeInTheDocument();
  });

  test('registers the runtime message listener exactly once and removes it on unmount', async () => {
    mockChrome.runtime.onMessage.addListener.mockClear();
    mockChrome.runtime.onMessage.removeListener.mockClear();
    // Answer storage reads so initData runs to completion.
    const originalGet = mockChrome.storage.local.get;
    mockChrome.storage.local.get = jest.fn().mockImplementation((_key: any, callback?: (result: any) => void) => {
      if (callback) { callback({}); }
      return Promise.resolve({});
    });

    const { unmount } = render(<App isRecording={false}
      isPowerAutomatePage={false}
      isRecordingPage={true}
      hasActionsOnPageToCopy={false}
      actions={[]}
      myClipboardActions={[]}
      currentMode={Mode.Requests}
      favoriteActions={[]}
      />);

    try {
      // Let initData settle; it must not register a second listener.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);

      const listener = mockChrome.runtime.onMessage.addListener.mock.calls[0][0];
      unmount();
      expect(mockChrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
    } finally {
      mockChrome.storage.local.get = originalGet;
    }
  });

  describe('content script injection', () => {
    const renderApp = (overrides: Partial<React.ComponentProps<typeof App>> = {}) => render(<App isRecording={false}
      isPowerAutomatePage={false}
      isRecordingPage={false}
      hasActionsOnPageToCopy={false}
      actions={[]}
      myClipboardActions={[]}
      currentMode={Mode.Requests}
      favoriteActions={[]}
      {...overrides}
      />);

    let originalGet: any;
    let calls: string[];
    let storedSettings: any;
    let store: Record<string, any>;
    let flowPage: { isFlowPage: boolean; isEnvironmentPage: boolean };

    beforeEach(() => {
      calls = [];
      storedSettings = undefined;
      store = {};
      flowPage = { isFlowPage: false, isEnvironmentPage: false };
      originalGet = mockChrome.storage.local.get;
      mockChrome.storage.local.get = jest.fn().mockImplementation((key: any, callback?: (result: any) => void) => {
        const result = key === 'appSettings'
          ? { appSettings: storedSettings }
          : { [key]: store[key] };
        if (callback) { callback(result); }
        return Promise.resolve(result);
      });
      mockChrome.storage.local.set = jest.fn().mockImplementation((items: Record<string, any>) => {
        Object.assign(store, items);
        return Promise.resolve();
      });
      mockChrome.runtime.sendMessage = jest.fn().mockImplementation((message: any, callback?: (r: any) => void) => {
        calls.push(message?.type ?? `runtime:${message?.actionType}`);
        if (callback) {
          callback(message?.type === 'check-flow-page' ? flowPage : message?.type?.startsWith('open-') ? { success: true } : undefined);
          return undefined;
        }
        return Promise.resolve(message?.type === 'ensure-content-script' ? { success: true, injected: true } : undefined);
      });
      mockChrome.tabs.query = jest.fn().mockImplementation((_q: any, callback: (tabs: any[]) => void) => {
        calls.push('tabs.query');
        callback([{ id: 7 }]);
      });
      mockChrome.tabs.sendMessage = jest.fn().mockImplementation((_id: number, message: any) => {
        calls.push(`content:${message.actionType}`);
      });
    });

    afterEach(() => {
      mockChrome.storage.local.get = originalGet;
    });

    test('asks the background to inject the content script before any page message', async () => {
      renderApp();

      await waitFor(() => expect(calls).toContain('tabs.query'));
      const ensureIndex = calls.indexOf('ensure-content-script');
      const firstContentIndex = calls.indexOf('tabs.query');
      expect(ensureIndex).toBeGreaterThanOrEqual(0);
      expect(ensureIndex).toBeLessThan(firstContentIndex);
    });

    test('still talks to the page when the background cannot inject', async () => {
      mockChrome.runtime.sendMessage = jest.fn().mockImplementation((message: any, callback?: (r: any) => void) => {
        calls.push(message?.type ?? 'runtime');
        if (callback) { callback(undefined); return undefined; }
        return Promise.reject(new Error('Receiving end does not exist'));
      });

      renderApp();

      await waitFor(() => expect(calls).toContain('tabs.query'));
      expect(calls[0]).toBe('ensure-content-script');
    });

    test('shows a turn-on banner when the toolkit is switched off', async () => {
      storedSettings = { extensionEnabled: false };
      renderApp();

      expect(await screen.findByText('Toolkit is turned off')).toBeInTheDocument();
      act(() => {
        screen.getByRole('button', { name: 'Turn on' }).click();
      });

      await waitFor(() => {
        expect(mockChrome.storage.local.set).toHaveBeenCalledWith({ appSettings: expect.objectContaining({ extensionEnabled: true }) });
      });
      await waitFor(() => expect(screen.queryByText('Toolkit is turned off')).not.toBeInTheDocument());
    });

    test('does not show the banner when the setting is absent', async () => {
      renderApp();
      await waitFor(() => expect(calls).toContain('ensure-content-script'));
      expect(screen.queryByText('Toolkit is turned off')).not.toBeInTheDocument();
    });

    const recorded = [
      { id: 'a1', title: 'Create item', url: 'https://contoso.sharepoint.com/_api/web/lists', method: 'POST', icon: '', actionJson: '{}' },
      { id: 'a2', title: 'Get items', url: 'https://contoso.sharepoint.com/_api/web/items', method: 'GET', icon: '', actionJson: '{}' },
    ];

    test('awaits injection before "Copy all actions from this page"', async () => {
      renderApp({ hasActionsOnPageToCopy: true });
      await waitFor(() => expect(calls).toContain('tabs.query'));
      // Let the probe reuse window lapse so the click triggers its own probe.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 1600)); });
      calls.length = 0;

      act(() => {
        screen.getByRole('button', { name: 'Copy all actions from this page' }).click();
      });

      await waitFor(() => expect(calls).toContain(`content:${ActionType.CopyAllActionsFromPage}`));
      expect(calls.indexOf('ensure-content-script')).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf('ensure-content-script')).toBeLessThan(calls.indexOf('tabs.query'));
    });

    test('makes "Edit flow JSON" the primary action on a flow page', async () => {
      flowPage = { isFlowPage: true, isEnvironmentPage: true };
      renderApp();

      const edit = await screen.findByRole('button', { name: /Edit flow JSON/ });
      await waitFor(() => expect(edit).not.toHaveAttribute('aria-disabled', 'true'));
      expect(edit).toHaveClass('ms-Button--primary');
      expect(screen.queryByText('Open a flow in Power Automate')).not.toBeInTheDocument();

      act(() => { edit.click(); });
      expect(calls).toContain('open-flow-editor');
    });

    test('makes "Browse flows" the primary action on an environment page', async () => {
      flowPage = { isFlowPage: false, isEnvironmentPage: true };
      renderApp();

      await waitFor(() => expect(screen.getByRole('button', { name: /Browse flows/ })).toHaveClass('ms-Button--primary'));
      expect(screen.queryByRole('button', { name: /Edit flow JSON/ })).not.toBeInTheDocument();
    });

    test('shows a selection bar for selected rows and clears the selection', async () => {
      store.recordedActions = recorded;
      renderApp({ isRecordingPage: true });

      const checkbox = await screen.findByRole('checkbox', { name: 'Create item' });
      expect(screen.queryByRole('region', { name: 'Selected actions' })).not.toBeInTheDocument();

      act(() => { checkbox.click(); });

      const bar = screen.getByRole('region', { name: 'Selected actions' });
      expect(bar).toHaveTextContent('1 selected');
      expect(screen.getByRole('button', { name: 'Copy for new designer' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add to favorites' })).toBeInTheDocument();

      act(() => { screen.getByRole('button', { name: 'Clear selection' }).click(); });
      expect(screen.queryByRole('region', { name: 'Selected actions' })).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Create item' })).not.toBeChecked();
    });

    test('adds the selection to favorites and lets the confirmation go after a few seconds', async () => {
      store.recordedActions = recorded;
      renderApp({ isRecordingPage: true });

      const checkbox = await screen.findByRole('checkbox', { name: 'Create item' });
      act(() => { checkbox.click(); });
      jest.useFakeTimers();
      try {
        await act(async () => { screen.getByRole('button', { name: 'Add to favorites' }).click(); });
        await act(async () => { await Promise.resolve(); });

        expect(store.favoriteActions).toEqual([expect.objectContaining({ id: 'a1', isFavorite: true })]);
        expect(await screen.findByText('Added 1 action(s) to favorites')).toBeInTheDocument();

        act(() => { jest.advanceTimersByTime(4100); });
        expect(screen.queryByText('Added 1 action(s) to favorites')).not.toBeInTheDocument();
      } finally {
        jest.useRealTimers();
      }
    });

    test('asks before clearing a list', async () => {
      store.recordedActions = recorded;
      renderApp({ isRecordingPage: true });

      const clear = await screen.findByRole('button', { name: 'Clear all recorded actions' });
      act(() => { clear.click(); });

      expect(await screen.findByText('Clear 2 recorded actions?')).toBeInTheDocument();
      expect(mockChrome.storage.local.set).not.toHaveBeenCalledWith({ recordedActions: [] });

      act(() => { screen.getByRole('button', { name: 'Clear' }).click(); });

      await waitFor(() => expect(mockChrome.storage.local.set).toHaveBeenCalledWith({ recordedActions: [] }));
      expect(await screen.findByText('No recorded requests yet')).toBeInTheDocument();
    });

    test('names a page forced to the classic editor "Classic designer"', async () => {
      storedSettings = { isClassicPowerAutomatePage: true, isRecordingPage: false, isModernPowerAutomatePage: false };
      renderApp();
      expect(await screen.findByText('Classic designer')).toBeInTheDocument();
    });

    test('does not offer Clear on the Library tab', async () => {
      storedSettings = { loadDefaultPredefinedActions: false };
      renderApp({ isRecordingPage: true });

      const library = await screen.findByRole('tab', { name: /^Library/ });
      act(() => { library.click(); });
      await screen.findByRole('textbox', { name: /Search library/ });
      expect(screen.queryByRole('button', { name: /^Clear all/ })).not.toBeInTheDocument();
    });
  });
});
