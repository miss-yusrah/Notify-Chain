import { render } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';
import { EventList } from '../components/EventList';
import { EventListNaive } from '../components/EventListNaive';
import { generateMockEvents } from '../utils/eventData';

const EVENT_COUNT = 2000;

function countRenderedRows(container: HTMLElement): number {
  return container.querySelectorAll('.event-row').length;
}

describe('event list render performance', () => {
  const events = generateMockEvents(EVENT_COUNT);

  it('virtualized list renders a bounded number of DOM nodes for large datasets', () => {
    const { container } = render(
      <div style={{ height: 600, width: 800 }}>
        <EventList events={events} />
      </div>
    );

    const renderedRows = countRenderedRows(container);
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThan(EVENT_COUNT);
    expect(renderedRows).toBeLessThan(50);
  });

  it('naive list renders every row and is measurably slower than virtualization', () => {
    const naiveStart = performance.now();
    const naiveRender = render(<EventListNaive events={events} />);
    const naiveDuration = performance.now() - naiveStart;
    const naiveRows = countRenderedRows(naiveRender.container);

    naiveRender.unmount();

    const virtualStart = performance.now();
    const virtualRender = render(
      <div style={{ height: 600, width: 800 }}>
        <EventList events={events} />
      </div>
    );
    const virtualDuration = performance.now() - virtualStart;
    const virtualRows = countRenderedRows(virtualRender.container);

    expect(naiveRows).toBe(EVENT_COUNT);
    expect(virtualRows).toBeLessThan(naiveRows);
    expect(virtualDuration).toBeLessThan(naiveDuration);
  });
});
