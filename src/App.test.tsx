import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import App from './App';
import { Mode } from './models';

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

  test('renders App component with default buttons', () => {
    render(<App isRecording={false}
      isPowerAutomatePage={false}
      isRecordingPage={true}
      hasActionsOnPageToCopy={false}
      actions={[]}
      myClipboardActions={[]}
      currentMode={Mode.Requests} 
      favoriteActions={[]}
      />);

    const clearButton = screen.getByTitle('Clear Items');
    expect(clearButton).toBeInTheDocument();

    const pivotComponent = screen.getByRole('tablist');
    expect(pivotComponent).toBeInTheDocument();

  });

  test('renders App component with correct buttons for SharePointPage', async () => {

    render(<App isRecording={false}
      isPowerAutomatePage={false}
      isRecordingPage={true}
      hasActionsOnPageToCopy={false}
      actions={[]}
      myClipboardActions={[]}
      currentMode={Mode.Requests} 
      favoriteActions={[]}
      />);

    const recordButton = screen.getByTitle('Start Recording');
    expect(recordButton).toBeInTheDocument();

    const clearButton = screen.getByTitle('Clear Items');
    expect(clearButton).toBeInTheDocument();

    const pivotComponent = screen.getByRole('tablist');
    expect(pivotComponent).toBeInTheDocument();

  });

  test('renders App component with correct buttons for SharePointPage while recording', async () => {

    render(<App isRecording={true}
      isPowerAutomatePage={false}
      isRecordingPage={true}
      hasActionsOnPageToCopy={false}
      actions={[]}
      myClipboardActions={[]}
      currentMode={Mode.Requests} 
      favoriteActions={[]}
      />);

    const recordButton = screen.getByTitle('Stop Recording');
    expect(recordButton).toBeInTheDocument();

    const clearButton = screen.getByTitle('Clear Items');
    expect(clearButton).toBeInTheDocument();

    const pivotComponent = screen.getByRole('tablist');
    expect(pivotComponent).toBeInTheDocument();

  });

  test('renders App component with correct buttons for Power Automate page', async () => {

    render(<App isRecording={false}
      isPowerAutomatePage={true}
      isRecordingPage={false}
      hasActionsOnPageToCopy={false}
      actions={[]}
      myClipboardActions={[]}
      currentMode={Mode.Requests} 
      favoriteActions={[]}
      />);

    const getMyClipboardActions = screen.getByTitle("Get 'My Clipboard Actions'");
    expect(getMyClipboardActions).toBeInTheDocument();

    const copyItems = screen.getByTitle("Copy Items");
    expect(copyItems).toBeInTheDocument();

    const clearButton = screen.getByTitle('Clear Items');
    expect(clearButton).toBeInTheDocument();

    const pivotComponent = screen.getByRole('tablist');
    expect(pivotComponent).toBeInTheDocument();

  });

  test('renders App component with correct buttons for Blog page', async () => {

    render(<App isRecording={false}
      isPowerAutomatePage={false}
      isRecordingPage={false}
      hasActionsOnPageToCopy={true}
      actions={[]}
      myClipboardActions={[]}
      currentMode={Mode.Requests} 
      favoriteActions={[]}
      />);

    const actionsButton = screen.getByTitle("Copy All Actions from the Page");
    expect(actionsButton).toBeInTheDocument();

    const clearButton = screen.getByTitle('Clear Items');
    expect(clearButton).toBeInTheDocument();

    const pivotComponent = screen.getByRole('tablist');
    expect(pivotComponent).toBeInTheDocument();

  });

  test('renders App component with Settings tab', async () => {
    render(<App isRecording={false}
      isPowerAutomatePage={false}
      isRecordingPage={false}
      hasActionsOnPageToCopy={false}
      actions={[]}
      myClipboardActions={[]}
      currentMode={Mode.Settings}
      favoriteActions={[]}
      />);

    const settingsButton = screen.getByTitle('Settings');
    expect(settingsButton).toBeInTheDocument();

    act(() => {
      settingsButton.click();
    });

    await waitFor(() => {
      const settingsContent = screen.getByText('Extension Settings');
      expect(settingsContent).toBeInTheDocument();
    });
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
});
