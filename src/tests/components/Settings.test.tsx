import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Settings from '../../components/Settings';
import { IStorageService } from '../../services/interfaces';
import { ISettingsModel, defaultSettings } from '../../models';
import { defaultAnalysisConfig } from '../../config/AnalysisConfig';
import { PlaceholderService } from '../../services/PlaceholderService';

// Mock storage service
const mockStorageService: IStorageService = {
  getRecordedActions: jest.fn(),
  addNewRecordedAction: jest.fn(),
  deleteRecordedAction: jest.fn(),
  updateRecordedAction: jest.fn(),
  clearRecordedActions: jest.fn(),
  getMyClipboardActions: jest.fn(),
  addNewMyClipboardAction: jest.fn(),
  setNewMyClipboardActions: jest.fn(),
  deleteMyClipboardAction: jest.fn(),
  updateMyClipboardAction: jest.fn(),
  clearMyClipboardActions: jest.fn(),
  getIsRecordingValue: jest.fn(),
  setIsRecordingValue: jest.fn(),
  getFavoriteActions: jest.fn(),
  addFavoriteAction: jest.fn(),
  removeFavoriteAction: jest.fn(),
  updateFavoriteAction: jest.fn(),
  clearFavoriteActions: jest.fn(),
  setFavoriteActions: jest.fn(),
  // Settings methods
  getSettings: jest.fn(),
  updateSettings: jest.fn(),
  resetSettings: jest.fn(),
  // Analysis config methods
  getAnalysisConfig: jest.fn(),
  updateAnalysisConfig: jest.fn(),
  resetAnalysisConfig: jest.fn(),
  // Saved flow analysis methods
  getSavedFlowAnalysis: jest.fn(),
  saveFlowAnalysis: jest.fn(),
  clearSavedFlowAnalysis: jest.fn(),
};

describe('Settings component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockStorageService.getSettings as jest.Mock).mockResolvedValue(defaultSettings);
    (mockStorageService.getAnalysisConfig as jest.Mock).mockResolvedValue(defaultAnalysisConfig);
    (mockStorageService.updateSettings as jest.Mock).mockImplementation(
      (partialSettings: Partial<ISettingsModel>) => 
        Promise.resolve({ ...defaultSettings, ...partialSettings })
    );
  });

  test('renders Settings component with correct heading', () => {
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);

    expect(screen.getByRole('heading', { name: 'Settings', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Configure how Power Automate Toolkit behaves')).toBeInTheDocument();
  });

  test('renders all settings sections', () => {
    const placeholderService = new PlaceholderService();
    jest.spyOn(placeholderService, 'getGlobalPlaceholders').mockResolvedValue({});
    render(<Settings defaultExpanded="all" storageService={mockStorageService} placeholderService={placeholderService} />);

    for (const name of ['General', 'Recording', 'Library', 'Placeholders', 'Favorites import/export', 'Flow editor analysis', 'Naming conventions']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name.replace('/', '\\/')}`) })).toHaveAttribute('aria-expanded', 'true');
    }
    expect(screen.getByText('Page Detection Mode')).toBeInTheDocument();
  });

  test('opens on General with the other sections collapsed, and toggles a section', () => {
    render(<Settings storageService={mockStorageService} />);

    expect(screen.getByRole('button', { name: /^General/ })).toHaveAttribute('aria-expanded', 'true');
    const recording = screen.getByRole('button', { name: /^Recording/ });
    expect(recording).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Page Detection Mode')).not.toBeInTheDocument();

    fireEvent.click(recording);
    expect(recording).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Page Detection Mode')).toBeInTheDocument();
  });

  test('opens straight at the utility block when asked to', () => {
    const scrollIntoView = jest.fn();
    (Element.prototype as any).scrollIntoView = scrollIntoView;
    try {
      render(<Settings storageService={mockStorageService} focusSection="utility" />);

      expect(screen.getByRole('button', { name: /^Library/ })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('textbox', { name: 'Function App URL' })).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      delete (Element.prototype as any).scrollIntoView;
    }
  });

  test('renders a Back button when given onBack', () => {
    const onBack = jest.fn();
    render(<Settings storageService={mockStorageService} onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to actions' }));
    expect(onBack).toHaveBeenCalled();
  });

  test('renders Page Detection Mode setting', () => {
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    
    const settingTitle = screen.getByText('Page Detection Mode');
    expect(settingTitle).toBeInTheDocument();
    
    const automaticOption = screen.getByRole('radio', { name: 'Automatic Detection' });
    expect(automaticOption).toBeInTheDocument();
    
    const recordingOption = screen.getByRole('radio', { name: 'Recording Page Override' });
    expect(recordingOption).toBeInTheDocument();
  });

  test('renders Power Automate page options', () => {
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    
    const classicOption = screen.getByRole('radio', { name: 'Classic Power Automate Editor' });
    expect(classicOption).toBeInTheDocument();
    
    const modernOption = screen.getByRole('radio', { name: 'Modern Power Automate Editor' });
    expect(modernOption).toBeInTheDocument();
  });

  test('renders recording time setting', () => {
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);

    const timeField = screen.getByPlaceholderText('No limit');
    expect(timeField).toBeInTheDocument();
    expect(timeField).toHaveAttribute('type', 'number');
  });

  test('loads initial settings from storage', async () => {
    const testSettings: ISettingsModel = { 
      ...defaultSettings,
      isRecordingPage: true,
      showActionSearchBar: false 
    };
    (mockStorageService.getSettings as jest.Mock).mockResolvedValue(testSettings);
    
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    
    await waitFor(() => {
      expect(mockStorageService.getSettings).toHaveBeenCalled();
    });
  });

  test('shows automatic detection message when SharePoint value is null', async () => {
    // This test is no longer relevant since we removed the automatic detection messages
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    
    const automaticOption = screen.getByRole('radio', { name: 'Automatic Detection' });
    expect(automaticOption).toBeChecked();
  });

  test('shows Power Automate automatic detection message when both values are null', async () => {
    // This test is no longer relevant since we removed the automatic detection messages 
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    
    const pageDetectionTitle = screen.getByText('Page Detection Mode');
    expect(pageDetectionTitle).toBeInTheDocument();
  });

  test('updates Recording Page settings when option is selected', async () => {
    const updatedSettings: ISettingsModel = { 
      ...defaultSettings, 
      isRecordingPage: true,
      isClassicPowerAutomatePage: false,
      isModernPowerAutomatePage: false 
    };
    (mockStorageService.updateSettings as jest.Mock).mockResolvedValue(updatedSettings);
    
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    
    const recordingOption = screen.getByRole('radio', { name: 'Recording Page Override' });
    fireEvent.click(recordingOption);
    
    await waitFor(() => {
      expect(mockStorageService.updateSettings).toHaveBeenCalledWith({ 
        isRecordingPage: true,
        isClassicPowerAutomatePage: false,
        isModernPowerAutomatePage: false 
      });
    });
  });

  test('updates classic Power Automate setting and disables others when enabled', async () => {
    const updatedSettings: ISettingsModel = { 
      ...defaultSettings, 
      isRecordingPage: false,
      isClassicPowerAutomatePage: true,
      isModernPowerAutomatePage: false 
    };
    (mockStorageService.updateSettings as jest.Mock).mockResolvedValue(updatedSettings);
    
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    
    const classicOption = screen.getByRole('radio', { name: 'Classic Power Automate Editor' });
    fireEvent.click(classicOption);
    
    await waitFor(() => {
      expect(mockStorageService.updateSettings).toHaveBeenCalledWith({ 
        isRecordingPage: false,
        isClassicPowerAutomatePage: true,
        isModernPowerAutomatePage: false 
      });
    });
  });

  test('updates modern Power Automate setting and disables others when enabled', async () => {
    const updatedSettings: ISettingsModel = { 
      ...defaultSettings, 
      isRecordingPage: false,
      isModernPowerAutomatePage: true,
      isClassicPowerAutomatePage: false 
    };
    (mockStorageService.updateSettings as jest.Mock).mockResolvedValue(updatedSettings);
    
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    
    const modernOption = screen.getByRole('radio', { name: 'Modern Power Automate Editor' });
    fireEvent.click(modernOption);
    
    await waitFor(() => {
      expect(mockStorageService.updateSettings).toHaveBeenCalledWith({ 
        isRecordingPage: false,
        isModernPowerAutomatePage: true,
        isClassicPowerAutomatePage: false 
      });
    });
  });

  test('updates to automatic detection mode when switching from another mode', async () => {
    // Start with recording page enabled
    const initialSettings: ISettingsModel = {
      ...defaultSettings,
      isRecordingPage: true
    };
    (mockStorageService.getSettings as jest.Mock).mockResolvedValue(initialSettings);

    const updatedSettings: ISettingsModel = {
      ...defaultSettings,
      isRecordingPage: false,
      isClassicPowerAutomatePage: false,
      isModernPowerAutomatePage: false
    };
    (mockStorageService.updateSettings as jest.Mock).mockResolvedValue(updatedSettings);

    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);

    // Wait for initial settings to load so recording mode is selected
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Recording Page Override' })).toBeChecked();
    });

    const automaticOption = screen.getByRole('radio', { name: 'Automatic Detection' });
    fireEvent.click(automaticOption);

    await waitFor(() => {
      expect(mockStorageService.updateSettings).toHaveBeenCalledWith({
        isRecordingPage: false,
        isClassicPowerAutomatePage: false,
        isModernPowerAutomatePage: false
      });
    });
  });

  test('updates maximum recording time setting', async () => {
    const updatedSettings: ISettingsModel = { ...defaultSettings, maximumRecordingTimeMinutes: 30 };
    (mockStorageService.updateSettings as jest.Mock).mockResolvedValue(updatedSettings);

    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);

    const timeField = screen.getByPlaceholderText('No limit');
    fireEvent.change(timeField, { target: { value: '30' } });

    await waitFor(() => {
      expect(mockStorageService.updateSettings).toHaveBeenCalledWith({ maximumRecordingTimeMinutes: 30 });
    });
  });

  test('saves the toolkit master switch under appSettings.extensionEnabled', async () => {
    const onSettingsChange = jest.fn();
    render(<Settings defaultExpanded="all" storageService={mockStorageService} onSettingsChange={onSettingsChange} />);

    const toggle = screen.getByRole('switch', { name: 'Enable toolkit on Power Automate pages' });
    expect(toggle).toBeChecked();
    expect(screen.getByText('Turns off token capture, recording and the designer button')).toBeInTheDocument();
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockStorageService.updateSettings).toHaveBeenCalledWith({ extensionEnabled: false });
    });
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ extensionEnabled: false }));
  });

  test('saves the designer button toggle', async () => {
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);

    const toggle = screen.getByRole('switch', { name: "Show 'Edit JSON' button in the flow designer" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockStorageService.updateSettings).toHaveBeenCalledWith({ showDesignerButton: false });
    });
  });

  test('treats absent platform settings as on', async () => {
    const { extensionEnabled, showDesignerButton, ...legacy } = defaultSettings;
    (mockStorageService.getSettings as jest.Mock).mockResolvedValue(legacy);
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);

    await waitFor(() => expect(mockStorageService.getSettings).toHaveBeenCalled());
    expect(screen.getByRole('switch', { name: 'Enable toolkit on Power Automate pages' })).toBeChecked();
    expect(screen.getByRole('switch', { name: "Show 'Edit JSON' button in the flow designer" })).toBeChecked();
  });

  test('no longer offers the unused search bar toggle', () => {
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    expect(screen.queryByText('Show Action Search Bar')).not.toBeInTheDocument();
  });

  test('uses an icon, not an emoji, for info tips', () => {
    const { container } = render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    expect(container.textContent).not.toContain('ℹ️');
    expect(screen.getByTestId('recording-time-info-icon')).toHaveAttribute('data-icon-name', 'Info');
  });

  test('shows tooltip for recording time info icon', async () => {
    render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    
    const infoIcon = screen.getByTestId('recording-time-info-icon');
    expect(infoIcon).toBeInTheDocument();
    
    const tooltipText = screen.getByText(/Set a maximum duration for recording sessions/);
    expect(tooltipText).toBeInTheDocument();
  });

  test('calls onSettingsChange callback when page mode changes', async () => {
    const onSettingsChange = jest.fn();
    const updatedSettings: ISettingsModel = { 
      ...defaultSettings, 
      isRecordingPage: true,
      isClassicPowerAutomatePage: false,
      isModernPowerAutomatePage: false 
    };
    (mockStorageService.updateSettings as jest.Mock).mockResolvedValue(updatedSettings);
    
    render(<Settings defaultExpanded="all" storageService={mockStorageService} onSettingsChange={onSettingsChange} />);
    
    const recordingOption = screen.getByRole('radio', { name: 'Recording Page Override' });
    fireEvent.click(recordingOption);
    
    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledWith(updatedSettings);
    });
  });
});
describe('Settings handleFileChange (favorites import)', () => {
  // jsdom's File has no text(); the component reads uploads with it.
  const originalText = (File.prototype as any).text;
  beforeAll(() => {
    if (typeof originalText !== 'function') {
      (File.prototype as any).text = function (this: File) {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(this);
        });
      };
    }
  });
  afterAll(() => {
    (File.prototype as any).text = originalText;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (mockStorageService.getSettings as jest.Mock).mockResolvedValue(defaultSettings);
    (mockStorageService.getAnalysisConfig as jest.Mock).mockResolvedValue(defaultAnalysisConfig);
  });

  const getHiddenFileInput = (container: HTMLElement) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).toBeInTheDocument();
    return input as HTMLInputElement;
  };

  test('imports favorites by merging with existing favorites and skipping duplicates (existing + within file)', async () => {
    const onFavoritesImported = jest.fn();

    const existingFavorite = { id: 'existing-1', title: 'Existing', actionJson: '{"a":1}' };
    const newFavorite1 = { id: 'new-1', title: 'New 1', actionJson: '{"b":1}' };
    const newFavorite1Duplicate = { id: 'new-1', title: 'New 1 Duplicate', actionJson: '{"b":2}' };
    const newFavorite2 = { id: 'new-2', title: 'New 2', actionJson: '{"c":1}' };
    const existingDuplicateFromFile = { id: 'existing-1', title: 'Existing Duplicate', actionJson: '{"a":2}' };

    (mockStorageService.getFavoriteActions as jest.Mock).mockResolvedValue([existingFavorite]);
    (mockStorageService.setFavoriteActions as jest.Mock).mockResolvedValue(undefined);

    const { container } = render(
      <Settings defaultExpanded="all" storageService={mockStorageService} onFavoritesImported={onFavoritesImported} />
    );

    const fileInput = getHiddenFileInput(container);
    const file = new File(
      [
        JSON.stringify([
          existingDuplicateFromFile,
          newFavorite1,
          newFavorite1Duplicate,
          newFavorite2,
        ]),
      ],
      'favorites.json',
      { type: 'application/json' }
    );

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockStorageService.setFavoriteActions).toHaveBeenCalledTimes(1);
    });

    expect(mockStorageService.setFavoriteActions).toHaveBeenCalledWith([
      existingFavorite,
      newFavorite1,
      newFavorite2,
    ]);

    const feedback = await screen.findByText('Successfully imported 2 new favorite action(s) (2 duplicate(s) skipped)');
    // Shown next to the Import button, not at the top of a scrolled page.
    // eslint-disable-next-line testing-library/no-node-access
    expect(feedback.closest('#settings-favorites')).not.toBeNull();

    expect(onFavoritesImported).toHaveBeenCalledTimes(1);
  });

  test('shows error when selected file is not JSON', async () => {
    (mockStorageService.getFavoriteActions as jest.Mock).mockResolvedValue([]);
    (mockStorageService.setFavoriteActions as jest.Mock).mockResolvedValue(undefined);

    const { container } = render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    const fileInput = getHiddenFileInput(container);
    const file = new File(['[]'], 'favorites.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText('Please select a valid JSON file')).toBeInTheDocument();
    expect(mockStorageService.getFavoriteActions).not.toHaveBeenCalled();
    expect(mockStorageService.setFavoriteActions).not.toHaveBeenCalled();
  });

  test('shows error for invalid JSON format', async () => {
    const onFavoritesImported = jest.fn();
    (mockStorageService.getFavoriteActions as jest.Mock).mockResolvedValue([]);
    (mockStorageService.setFavoriteActions as jest.Mock).mockResolvedValue(undefined);

    const { container } = render(
      <Settings defaultExpanded="all" storageService={mockStorageService} onFavoritesImported={onFavoritesImported} />
    );
    const fileInput = getHiddenFileInput(container);
    const file = new File(['{invalid json'], 'favorites.json', { type: 'application/json' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByText('Failed to import favorites: Invalid JSON format')
      ).toBeInTheDocument();
    });

    expect(mockStorageService.setFavoriteActions).not.toHaveBeenCalled();
    expect(onFavoritesImported).not.toHaveBeenCalled();
  });

  test('shows error when JSON is not an array of actions', async () => {
    (mockStorageService.getFavoriteActions as jest.Mock).mockResolvedValue([]);
    (mockStorageService.setFavoriteActions as jest.Mock).mockResolvedValue(undefined);

    const { container } = render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    const fileInput = getHiddenFileInput(container);
    const file = new File([JSON.stringify({ id: 'x' })], 'favorites.json', {
      type: 'application/json',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByText('Invalid file format: Expected an array of actions')
      ).toBeInTheDocument();
    });

    expect(mockStorageService.setFavoriteActions).not.toHaveBeenCalled();
  });

  test('shows error when any imported action is missing required properties', async () => {
    (mockStorageService.getFavoriteActions as jest.Mock).mockResolvedValue([]);
    (mockStorageService.setFavoriteActions as jest.Mock).mockResolvedValue(undefined);

    const { container } = render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    const fileInput = getHiddenFileInput(container);
    const file = new File(
      [
        JSON.stringify([
          { id: '1', title: 'Valid', actionJson: '{}' },
          { id: '2', title: 'Missing Action Json' },
        ]),
      ],
      'favorites.json',
      { type: 'application/json' }
    );

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByText('Invalid file format: Missing required action properties')
      ).toBeInTheDocument();
    });

    expect(mockStorageService.setFavoriteActions).not.toHaveBeenCalled();
  });
});

describe('Settings global placeholder variables', () => {
  let store: Record<string, any>;
  const originalText = (File.prototype as any).text;

  beforeAll(() => {
    if (typeof originalText !== 'function') {
      (File.prototype as any).text = function (this: File) {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(this);
        });
      };
    }
  });
  afterAll(() => {
    (File.prototype as any).text = originalText;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    store = {};
    (global as any).chrome = {
      storage: {
        local: {
          get: jest.fn((key: string, callback?: (result: any) => void) => {
            const result = { [key]: store[key] };
            if (callback) { callback(result); return undefined; }
            return Promise.resolve(result);
          }),
          set: jest.fn((items: Record<string, any>) => {
            Object.assign(store, items);
            return Promise.resolve();
          }),
        },
      },
    };
    (mockStorageService.getSettings as jest.Mock).mockResolvedValue(defaultSettings);
    (mockStorageService.getAnalysisConfig as jest.Mock).mockResolvedValue(defaultAnalysisConfig);
    (mockStorageService.updateAnalysisConfig as jest.Mock).mockResolvedValue(defaultAnalysisConfig);
  });

  test('renders the section only when a placeholder service is provided', async () => {
    const { PlaceholderService } = await import('../../services/PlaceholderService');
    const { unmount } = render(<Settings defaultExpanded="all" storageService={mockStorageService} />);
    expect(screen.queryByRole('button', { name: /^Placeholders/ })).not.toBeInTheDocument();
    unmount();

    render(<Settings defaultExpanded="all" storageService={mockStorageService} placeholderService={new PlaceholderService()} />);
    expect(screen.getByRole('button', { name: /^Placeholders/ })).toBeInTheDocument();
  });

  test('merges placeholder values from an imported configuration file', async () => {
    const { PlaceholderService } = await import('../../services/PlaceholderService');
    store.globalPlaceholders = { SITE_NAME: ['Existing'] };

    const { container } = render(
      <Settings defaultExpanded="all" storageService={mockStorageService} placeholderService={new PlaceholderService()} />
    );
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const configInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    const file = new File([JSON.stringify({
      version: '1.0',
      exportDate: new Date().toISOString(),
      config: defaultAnalysisConfig,
      globalPlaceholders: { SITE_NAME: ['Existing', 'Imported'], 'bad key': ['ignored'], LIST_TITLE: ['Docs'] },
    })], 'config.json', { type: 'application/json' });

    fireEvent.change(configInput, { target: { files: [file] } });

    expect(await screen.findByText(/imported successfully \(with 3 placeholder value\(s\)\)/)).toBeInTheDocument();
    expect(store.globalPlaceholders).toEqual({ SITE_NAME: ['Existing', 'Imported'], LIST_TITLE: ['Docs'] });
  });
});
