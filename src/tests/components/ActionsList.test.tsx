import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionsList from '../../components/ActionsList';
import { IActionModel, Mode } from '../../models';
import { PlaceholderService } from '../../services/PlaceholderService';

describe('ActionsList', () => {
  const mockActions: IActionModel[] = [
    {
      id: 'action-1',
      url: 'https://example.com/api/test1',
      icon: 'https://example.com/icon1.png',
      title: 'Test Action 1',
      method: 'GET',
      actionJson: '{"test": "json1"}',
      isSelected: false,
      body: null
    },
    {
      id: 'action-2',
      url: 'https://example.com/api/test2',
      icon: 'https://example.com/icon2.png',
      title: 'Test Action 2',
      method: 'POST',
      actionJson: '{"test": "json2"}',
      isSelected: true,
      body: { data: 'test' }
    }
  ];

  const defaultProps = {
    actions: mockActions,
    mode: Mode.CopiedActions,
    changeSelectionFunc: jest.fn(),
    deleteActionFunc: jest.fn(),
    editActionFunc: jest.fn(),
    showButton: false,
    searchTerm: '',
    onSearchChange: jest.fn(),
    placeholderService: new PlaceholderService()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    test('should render actions when showButton is false', () => {
      render(<ActionsList {...defaultProps} showButton={false} />);

      expect(screen.getByText('Test Action 1')).toBeInTheDocument();
      expect(screen.getByText('Test Action 2')).toBeInTheDocument();
      expect(screen.getByText('GET')).toBeInTheDocument();
      expect(screen.getByText('POST')).toBeInTheDocument();

      // Should show checkboxes, not buttons
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
      expect(screen.queryAllByTitle('Select Action To Copy')).toHaveLength(0);
    });

    test('should render actions when showButton is true', () => {
      render(<ActionsList {...defaultProps} showButton={true} />);

      expect(screen.getByText('Test Action 1')).toBeInTheDocument();
      expect(screen.getByText('Test Action 2')).toBeInTheDocument();

      // Should show buttons, not checkboxes
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Select Test Action 1' })).toBeInTheDocument();
    });

    test('labels each row checkbox with the action title', () => {
      render(<ActionsList {...defaultProps} />);

      expect(screen.getByRole('checkbox', { name: 'Test Action 1' })).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Test Action 2' })).toBeChecked();
    });

    test('should render action icons correctly', () => {
      render(<ActionsList {...defaultProps} />);

      const images = screen.getAllByRole('img').filter(el => el.tagName === 'IMG');
      expect(images).toHaveLength(2);
      expect(images[0]).toHaveAttribute('src', 'https://example.com/icon1.png');
      expect(images[0]).toHaveAttribute('alt', 'Test Action 1');
      expect(images[1]).toHaveAttribute('src', 'https://example.com/icon2.png');
      expect(images[1]).toHaveAttribute('alt', 'Test Action 2');
    });

    test('renders row actions as named, focusable buttons', () => {
      render(<ActionsList {...defaultProps} toggleFavoriteFunc={jest.fn()} />);

      expect(screen.getByRole('button', { name: 'Delete Test Action 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show details for Test Action 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add to favorites: Test Action 1' })).toBeInTheDocument();
    });

    test('shows the full title as a tooltip and the method as a badge', () => {
      render(<ActionsList {...defaultProps} />);

      expect(screen.getByText('Test Action 1')).toHaveAttribute('title', 'Test Action 1');
      expect(screen.getByText('GET')).toHaveClass('App-Action-Method');
    });

    test('should render search field with correct placeholder', () => {
      render(<ActionsList {...defaultProps} />);

      const searchField = screen.getByRole('textbox', { name: 'Search actions by title' });
      expect(searchField).toHaveAttribute('placeholder', 'Search actions by title...');
    });
  });

  describe('Interactions', () => {
    test('should call changeSelectionFunc when checkbox is clicked', () => {
      const changeSelectionFunc = jest.fn();
      render(<ActionsList {...defaultProps} changeSelectionFunc={changeSelectionFunc} showButton={false} />);

      fireEvent.click(screen.getByRole('checkbox', { name: 'Test Action 1' }));

      expect(changeSelectionFunc).toHaveBeenCalledWith(mockActions[0]);
    });

    test('should call changeSelectionFunc when select button is clicked', () => {
      const changeSelectionFunc = jest.fn();
      render(<ActionsList {...defaultProps} changeSelectionFunc={changeSelectionFunc} showButton={true} />);

      fireEvent.click(screen.getByRole('button', { name: 'Select Test Action 1' }));

      expect(changeSelectionFunc).toHaveBeenCalledWith(mockActions[0]);
    });

    test('should call deleteActionFunc when delete button is clicked', () => {
      const deleteActionFunc = jest.fn();
      render(<ActionsList {...defaultProps} deleteActionFunc={deleteActionFunc} />);

      fireEvent.click(screen.getByRole('button', { name: 'Delete Test Action 1' }));

      expect(deleteActionFunc).toHaveBeenCalledWith(mockActions[0]);
    });

    test('should call functions with correct action for second item', () => {
      const changeSelectionFunc = jest.fn();
      const deleteActionFunc = jest.fn();
      render(<ActionsList
        {...defaultProps}
        changeSelectionFunc={changeSelectionFunc}
        deleteActionFunc={deleteActionFunc}
        showButton={false}
      />);

      fireEvent.click(screen.getByRole('checkbox', { name: 'Test Action 2' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Test Action 2' }));

      expect(changeSelectionFunc).toHaveBeenCalledWith(mockActions[1]);
      expect(deleteActionFunc).toHaveBeenCalledWith(mockActions[1]);
    });

    test('should call onSearchChange when search field changes', () => {
      const onSearchChange = jest.fn();
      render(<ActionsList {...defaultProps} onSearchChange={onSearchChange} />);

      fireEvent.change(screen.getByRole('textbox', { name: 'Search actions by title' }), { target: { value: 'test search' } });

      expect(onSearchChange).toHaveBeenCalledWith('test search');
    });

    test('offers a labelled clear-all button only when there is something to clear', () => {
      const onClearAll = jest.fn();
      const { rerender } = render(<ActionsList {...defaultProps} onClearAll={onClearAll} clearLabel="Clear all copied actions" />);

      fireEvent.click(screen.getByRole('button', { name: 'Clear all copied actions' }));
      expect(onClearAll).toHaveBeenCalled();

      rerender(<ActionsList {...defaultProps} actions={[]} onClearAll={onClearAll} clearLabel="Clear all copied actions" />);
      expect(screen.queryByRole('button', { name: 'Clear all copied actions' })).not.toBeInTheDocument();
    });

    const setContentEditableValue = (element: HTMLElement, value: string) => {
      // eslint-disable-next-line testing-library/no-node-access
      element.textContent = value;
      fireEvent.input(element);
      fireEvent.blur(element);
    };

    const openDetails = (title: string) => {
      fireEvent.click(screen.getByRole('button', { name: `Show details for ${title}` }));
      return screen.getByRole('dialog');
    };

    test('should enter edit mode and call editActionFunc on save', () => {
      const editActionFunc = jest.fn();
      render(<ActionsList {...defaultProps} editActionFunc={editActionFunc} />);

      const panel = openDetails('Test Action 1');
      fireEvent.click(within(panel).getAllByRole('button', { name: 'Edit URL, headers and body' })[0]);

      const editableFields = within(panel).getAllByRole('textbox').filter(el => el.getAttribute('contenteditable') === 'true');
      const [urlField, headersField, bodyField] = editableFields;
      setContentEditableValue(urlField, 'https://edited.example.com');
      setContentEditableValue(headersField, '{"Authorization":"Bearer token"}');
      setContentEditableValue(bodyField, '{"hello":"world"}');

      fireEvent.click(within(panel).getAllByRole('button', { name: 'Save changes' })[0]);

      expect(editActionFunc).toHaveBeenCalledTimes(1);
      const editedAction = editActionFunc.mock.calls[0][0];
      expect(editedAction.url).toBe('https://edited.example.com');
      expect(editedAction.body).toEqual({ hello: 'world' });
    });

    test('should show validation error for invalid JSON during save', async () => {
      const editActionFunc = jest.fn();
      render(<ActionsList {...defaultProps} editActionFunc={editActionFunc} />);

      const panel = openDetails('Test Action 1');
      fireEvent.click(within(panel).getAllByRole('button', { name: 'Edit URL, headers and body' })[0]);

      const editableFields = within(panel).getAllByRole('textbox').filter(el => el.getAttribute('contenteditable') === 'true');
      const bodyField = editableFields[editableFields.length - 1];
      setContentEditableValue(bodyField, '{invalid-json}');
      fireEvent.click(within(panel).getAllByRole('button', { name: 'Save changes' })[0]);

      expect(await within(panel).findByText('Headers and Body must be valid JSON.')).toBeInTheDocument();
      expect(editActionFunc).not.toHaveBeenCalled();
    });
  });

  describe('Empty states', () => {
    const emptyState = { iconName: 'Record2', title: 'No recorded requests yet', hint: 'Click Record, then use SharePoint — requests appear here.' };

    test('shows the how-to when the list is empty', () => {
      render(<ActionsList {...defaultProps} actions={[]} emptyState={emptyState} />);

      expect(screen.getByText('No recorded requests yet')).toBeInTheDocument();
      expect(screen.getByText('Click Record, then use SharePoint — requests appear here.')).toBeInTheDocument();
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    test('says no match (not empty) when a search hides everything', () => {
      const onSearchChange = jest.fn();
      render(<ActionsList {...defaultProps} actions={[]} totalCount={2} searchTerm="nope" onSearchChange={onSearchChange} emptyState={emptyState} />);

      expect(screen.getByText("No actions match 'nope'")).toBeInTheDocument();
      expect(screen.queryByText('No recorded requests yet')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Clear search'));
      expect(onSearchChange).toHaveBeenCalledWith('');
    });

    test('should handle undefined actions array', () => {
      render(<ActionsList {...defaultProps} actions={undefined as any} emptyState={emptyState} />);

      expect(screen.getByText('No recorded requests yet')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    test('should render action row with correct title attribute for URL', () => {
      const { container } = render(<ActionsList {...defaultProps} />);

      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
      const actionRows = container.querySelectorAll('.App-Action-Row');
      expect(actionRows[0]).toHaveAttribute('title', 'https://example.com/api/test1');
      expect(actionRows[1]).toHaveAttribute('title', 'https://example.com/api/test2');
    });

    test('should render select button with correct title', () => {
      render(<ActionsList {...defaultProps} showButton={true} />);

      const selectButtons = screen.getAllByTitle('Select Action To Copy');
      expect(selectButtons).toHaveLength(2);
    });
  });

  describe('Different Modes', () => {
    test('should work with Requests mode', () => {
      render(<ActionsList {...defaultProps} mode={Mode.Requests} />);

      expect(screen.getByText('Test Action 1')).toBeInTheDocument();
      expect(screen.getByText('Test Action 2')).toBeInTheDocument();
    });

    test('should work with CopiedActions mode', () => {
      render(<ActionsList {...defaultProps} mode={Mode.CopiedActions} />);

      expect(screen.getByText('Test Action 1')).toBeInTheDocument();
      expect(screen.getByText('Test Action 2')).toBeInTheDocument();
    });
  });
});
