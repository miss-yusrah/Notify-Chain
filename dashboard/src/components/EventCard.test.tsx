import { render, fireEvent, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { EventCard } from './EventCard';
import type { BlockchainEvent } from '../types/event';

expect.extend(toHaveNoViolations);

const LONG_HASH =
  'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

const mockEvent: BlockchainEvent = {
  eventId: 'evt-1-very-long-identifier-that-should-not-overflow-the-layout',
  type: 'TaskCreated',
  eventName: 'TaskCreated',
  ledger: 12345,
  contractAddress: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12',
  receivedAt: Date.now(),
  value: '{"message":"long payload content that must wrap on narrow viewports without horizontal scroll"}',
  txHash: LONG_HASH,
  topic: ['topic-with-a-very-long-name-that-needs-wrapping-on-mobile'],
} as BlockchainEvent;

test('clickable EventCard has no accessibility violations', async () => {
  const { container } = render(
    <EventCard event={mockEvent} onClick={() => {}} />
  );
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

test('activates on Space key, not just Enter', () => {
  const onClick = jest.fn();
  const { getByRole } = render(<EventCard event={mockEvent} onClick={onClick} />);
  const card = getByRole('button');

  fireEvent.keyDown(card, { key: ' ' });
  expect(onClick).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(card, { key: 'Enter' });
  expect(onClick).toHaveBeenCalledTimes(2);
});

describe('EventCard mobile detail layout (#680)', () => {
  const breakpoints = [375, 390, 414, 600] as const;

  afterEach(() => {
    document.documentElement.style.width = '';
  });

  it.each(breakpoints)('keeps expanded details readable at %spx without full hash overflow', (width) => {
    document.documentElement.style.width = `${width}px`;

    const { container } = render(<EventCard event={mockEvent} variant="expanded" />);

    expect(container.querySelector('.event-card--expanded')).toBeTruthy();
    expect(screen.getByTitle(LONG_HASH)).toBeInTheDocument();
    // Shortened display, not the raw 64+ char hash as the only text node
    expect(screen.queryByText(LONG_HASH)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy tx hash/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy contract address/i })).toBeInTheDocument();
    expect(container.querySelector('.event-card__payload')).toHaveTextContent(/long payload content/i);
  });
});
