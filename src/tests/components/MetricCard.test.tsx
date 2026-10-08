import { render, screen } from '@testing-library/react';
import { MetricCard, toneFromRating } from '../../features/flow-editor/components/MetricCard';

describe('MetricCard', () => {
  it('renders an em dash for a metric that does not apply', () => {
    render(<MetricCard label="Complexity" value={null} />);
    expect(screen.getByText('—')).toHaveAttribute('aria-label', 'Complexity: not applicable');
  });

  it('keeps body-coloured text on a tinted, token-based background', () => {
    const { container } = render(<MetricCard label="Warnings" value={3} tone="warning" hint="Amber at 1" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.dataset.tone).toBe('warning');
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Amber at 1')).toBeInTheDocument();
    // No white-on-orange: the card never sets a white text colour.
    expect(container.innerHTML).not.toMatch(/#fff\b|white/i);
  });

  it('maps analyzer traffic-light names to tones', () => {
    expect(toneFromRating('green')).toBe('success');
    expect(toneFromRating('orange')).toBe('warning');
    expect(toneFromRating('red')).toBe('danger');
    expect(toneFromRating('?')).toBe('neutral');
  });
});
