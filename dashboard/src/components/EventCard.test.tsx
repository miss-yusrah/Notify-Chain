import { render, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { EventCard } from './EventCard';
import type { BlockchainEvent } from '../types/event';

expect.extend(toHaveNoViolations);

const mockEvent: BlockchainEvent = {
  eventId: 'evt-1',
  type: 'TaskCreated',
  eventName: 'TaskCreated',
  ledger: 12345,
  contractAddress: 'GABCDEF1234567890ABCDEF1234567890ABCDEF12',
  receivedAt: Date.now(),
  value: '100',
  txHash: 'abcdef1234567890',
  topic: [],
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