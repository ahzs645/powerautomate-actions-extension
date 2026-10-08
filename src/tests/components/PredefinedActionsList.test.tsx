import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PredefinedActionsList from '../../components/PredefinedActionsList';
import { IActionModel } from '../../models';
import { PlaceholderService } from '../../services/PlaceholderService';

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
      expect(screen.getByText(/Action Details: Get User Profile/)).toBeInTheDocument();
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

  it('should display column headers', () => {
    render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    expect(screen.getByText('Select')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
  });

  it('should display favorite column when toggleFavoriteFunc is provided', () => {
    render(
      <PredefinedActionsList
        actions={mockActions}
        isLoading={false}
        toggleFavoriteFunc={() => {}}
        searchTerm=""
        onSearchChange={() => {}}
        placeholderService={mockPlaceholderService}
      />
    );
    expect(screen.getByText('Fav')).toBeInTheDocument();
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
