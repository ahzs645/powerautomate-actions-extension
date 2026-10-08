import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PredefinedActionsList from '../../components/PredefinedActionsList';
import { IActionModel } from '../../models';
import { PlaceholderService } from '../../services/PlaceholderService';
import { utilityActionsService } from '../../services/UtilityActionsService';

// The real service: the list only calls its pure parsing helpers, and CRA's
// resetMocks would wipe a jest.fn() mock's return values between tests.
const mockPlaceholderService = new PlaceholderService();

describe('PredefinedActionsList', () => {
  const mockActions: IActionModel[] = [
    {
      id: 'action-1',
      title: 'Get User Profile',
      url: 'https://graph.microsoft.com/v1.0/me',
      method: 'GET',
      body: null,
      icon: 'https://example.com/icon.png',
      actionJson: '{"method":"GET","url":"https://graph.microsoft.com/v1.0/me"}',
      isSelected: false,
      isFavorite: false
    },
    {
      id: 'action-2',
      title: 'Send Email',
      url: 'https://graph.microsoft.com/v1.0/me/sendMail',
      method: 'POST',
      body: '{"message":{}}',
      icon: 'https://example.com/icon.png',
      actionJson: '{"method":"POST","url":"https://graph.microsoft.com/v1.0/me/sendMail"}',
      isSelected: false,
      isFavorite: false
    }
  ];

  it('should render loading spinner when isLoading is true', () => {
    render(
      <PredefinedActionsList
        actions={[]}
        isLoading={true}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    expect(screen.getByText('Loading predefined actions...')).toBeInTheDocument();
  });

  it('should render empty state when no actions available', () => {
    render(
      <PredefinedActionsList
        actions={[]}
        isLoading={false}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    expect(screen.getByText('No predefined actions available')).toBeInTheDocument();
  });

  it('links an empty library to its settings', () => {
    const onOpenSettings = jest.fn();
    render(
      <PredefinedActionsList
        actions={[]}
        isLoading={false}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
        onOpenSettings={onOpenSettings}
      />
    );
    fireEvent.click(screen.getByText('Open library settings'));
    expect(onOpenSettings).toHaveBeenCalledWith('library');
  });

  it('explains a filtered-out list and offers to clear the filters', () => {
    const onSearchChange = jest.fn();
    render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        searchTerm="nothing-like-this"
        onSearchChange={onSearchChange}
        placeholderService={mockPlaceholderService}
      />
    );
    expect(screen.getByText("No actions match 'nothing-like-this' in all categories")).toBeInTheDocument();
    expect(screen.queryByText('No predefined actions available')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear filters'));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  describe('utility presets', () => {
    const utilityActions = utilityActionsService.getActions({});

    it('warns about the Function App URL only when utility presets are visible, with a link to settings', async () => {
      const onOpenSettings = jest.fn();
      const { rerender } = render(
        <PredefinedActionsList
          actions={[...mockActions, ...utilityActions]}
          isLoading={false}
          searchTerm=""
          onSearchChange={() => {}}
          placeholderService={mockPlaceholderService}
          onOpenSettings={onOpenSettings}
        />
      );
      expect(await screen.findByText(/Set the Function App URL in Settings/)).toBeInTheDocument();
      fireEvent.click(screen.getByText('Open utility settings'));
      expect(onOpenSettings).toHaveBeenCalledWith('utility');

      // Searching down to non-utility rows hides the warning.
      rerender(
        <PredefinedActionsList
          actions={[...mockActions, ...utilityActions]}
          isLoading={false}
          searchTerm="Get User Profile"
          onSearchChange={() => {}}
          placeholderService={mockPlaceholderService}
          onOpenSettings={onOpenSettings}
        />
      );
      expect(screen.queryByText(/Set the Function App URL in Settings/)).not.toBeInTheDocument();
    });

    it('labels the parameter form button "Configure parameters", not as a settings gear', () => {
      render(
        <PredefinedActionsList
          actions={utilityActions.slice(0, 1)}
          isLoading={false}
          searchTerm=""
          onSearchChange={() => {}}
          placeholderService={mockPlaceholderService}
          onConfiguredAction={() => {}}
        />
      );
      const button = screen.getByRole('button', { name: `Configure parameters: ${utilityActions[0].title}` });
      expect(button).toHaveAttribute('title', 'Configure parameters');
      // eslint-disable-next-line testing-library/no-node-access
      expect(button.querySelector('[data-icon-name="Settings"]')).toBeNull();
    });
  });

  it('should render list of actions', () => {
    render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    expect(screen.getByText('Get User Profile')).toBeInTheDocument();
    expect(screen.getByText('Send Email')).toBeInTheDocument();
  });

  it('should display action method', () => {
    render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
  });

  it('should call changeSelectionFunc when checkbox is clicked', () => {
    const mockChangeSelection = jest.fn();
    render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        changeSelectionFunc={mockChangeSelection}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(mockChangeSelection).toHaveBeenCalled();
  });

  it('should call toggleFavoriteFunc when favorite star is clicked', () => {
    const mockToggleFavorite = jest.fn();
    render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        toggleFavoriteFunc={mockToggleFavorite}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    
    const favoriteButtons = screen.getAllByTitle('Add to Favorites');
    fireEvent.click(favoriteButtons[0]);
    expect(mockToggleFavorite).toHaveBeenCalled();
  });

  it('should open details panel when info icon is clicked', async () => {
    render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    
    const infoButtons = screen.getAllByTitle('Show Action Details');
    fireEvent.click(infoButtons[0]);
    
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent('Get User Profile');
    });
  });

  it('should filter actions by search term', () => {
    const { rerender } = render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    expect(screen.getByText('Get User Profile')).toBeInTheDocument();
    expect(screen.getByText('Send Email')).toBeInTheDocument();

    rerender(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        searchTerm="Email"
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    expect(screen.queryByText('Get User Profile')).not.toBeInTheDocument();
    expect(screen.getByText('Send Email')).toBeInTheDocument();
  });

  it('labels the refresh button', () => {
    const onRefresh = jest.fn();
    render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        onRefresh={onRefresh}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh library' }));
    expect(onRefresh).toHaveBeenCalled();
  });

  describe('copy with options', () => {
    const buildAction = (id: string, title: string, uri: string): IActionModel => ({
      id,
      title,
      url: uri,
      method: 'POST',
      icon: 'https://example.com/icon.png',
      actionJson: JSON.stringify({ operationDefinition: { inputs: { uri } } }),
      isSelected: false,
      isFavorite: false,
    });

    const renderList = (actions: IActionModel[]) => render(
      <PredefinedActionsList
        actions={actions}
        isLoading={false}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );

    it('offers the button for actions with {{UPPER_CASE}} placeholders', () => {
      renderList([buildAction('p', 'Break inheritance', '{{SITE_URL}}/_api/web/lists/getbytitle(\'{{LIST_TITLE}}\')')]);
      expect(screen.getByTitle('Copy with options (fill placeholders)')).toBeInTheDocument();
    });

    it('does not offer it for actions that only contain expressions', () => {
      renderList([buildAction('e', 'Merge PDFs', "@{outputs('Compose')}/api/merge_pdf_fitz")]);
      expect(screen.queryByTitle('Copy with options (fill placeholders)')).not.toBeInTheDocument();
    });

    it('does not offer it for lower-case utility tokens', () => {
      renderList([buildAction('u', 'Utility', '{{functionBaseUrl}}/api/merge_pdf_fitz?code={{functionKey}}')]);
      expect(screen.queryByTitle('Copy with options (fill placeholders)')).not.toBeInTheDocument();
    });
  });
});
