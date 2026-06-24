# Requirements Document

## Introduction

This feature enhances the Event Explorer page in the Notify-Chain Web3 dashboard with an advanced search and multi-filter system. The current filtering supports a single free-text search, a single-select contract address dropdown, and a single-select event type dropdown with no debounce. The enhancement introduces debounced search, a multi-select event type filter (using the `type` field on `BlockchainEvent`), a date range filter against the `receivedAt` timestamp, a clear-all action, an improved empty state, and ensures performance, responsive layout, and accessibility standards are met.

## Glossary

- **EventExplorer**: The Event Explorer page component (`EventExplorerPage`) that renders the filter bar, event table, pagination, and empty state.
- **EventFiltersBar**: The React component that renders all filter controls (search input, contract filter, event type multi-select, date range inputs, clear-all button).
- **FilterEngine**: The `filterEvents` utility function in `eventData.ts` that applies all active filters to the in-memory event list.
- **EventStore**: The Zustand store (`eventStore.ts`) that holds `events`, `filters`, loading state, and all filter-mutation actions.
- **BlockchainEvent**: The TypeScript interface representing a single on-chain event, containing `eventId`, `contractAddress`, `eventName`, `ledger`, `type`, `topic`, `value`, `txHash`, and `receivedAt`.
- **EventFilters**: The TypeScript interface that holds all active filter state: `search`, `contractAddress`, `eventTypes` (set of selected type strings), `startDate`, and `endDate`.
- **DebounceInterval**: The 300 ms delay applied to the search input before the filter state is updated in the EventStore.
- **ReceivedAt**: The Unix millisecond timestamp field on `BlockchainEvent` used for date range filtering.
- **StartOfDayUTC**: Midnight (00:00:00.000 UTC) on the selected start date, expressed as a Unix ms timestamp.
- **EndOfDayUTC**: 23:59:59.999 UTC on the selected end date, expressed as a Unix ms timestamp.
- **ClearAllAction**: The Zustand store action that resets all filter fields to their default (empty/all) values in a single atomic update.

---

## Requirements

### Requirement 1: Debounced Contract ID Text Search

**User Story:** As a blockchain analyst, I want a debounced text search across event identifiers, so that the filter does not re-execute on every keystroke and the UI remains responsive during fast typing.

#### Acceptance Criteria

1. THE EventFiltersBar SHALL render a text input with a visible label for the search field.
2. WHEN the user types in the search input, THE EventFiltersBar SHALL update the visible input value immediately without delay.
3. WHEN the user stops typing for 300 ms, THE EventStore SHALL update the `search` field in `EventFilters` with the current input value.
4. WHEN the user resumes typing before 300 ms have elapsed, THE EventFiltersBar SHALL reset the debounce timer and not dispatch a store update.
5. WHEN the `search` filter is non-empty, THE FilterEngine SHALL include only events whose `contractAddress`, `eventId`, `eventName`, or `txHash` contains the search string (case-insensitive substring match).
6. WHEN the `search` filter is empty, THE FilterEngine SHALL apply no search restriction and return events matching the remaining active filters.

---

### Requirement 2: Event Type Multi-Select Filter

**User Story:** As a blockchain analyst, I want to select multiple event types simultaneously, so that I can view events of more than one type in a single filtered result set.

#### Acceptance Criteria

1. THE EventFiltersBar SHALL render a multi-select control with one toggle per distinct `type` value present in the loaded `BlockchainEvent` set (values: `contract`, `system`, `diagnostic`).
2. WHEN no event types are selected, THE FilterEngine SHALL apply no type restriction and return events matching the remaining active filters.
3. WHEN one or more event types are selected, THE FilterEngine SHALL include only events whose `type` field matches any of the selected types (OR logic within the type set).
4. WHEN an event type toggle is activated, THE EventStore SHALL add that type to the `eventTypes` set in `EventFilters`.
5. WHEN an active event type toggle is deactivated, THE EventStore SHALL remove that type from the `eventTypes` set in `EventFilters`.
6. THE EventFiltersBar SHALL visually distinguish selected type toggles from unselected ones.

---

### Requirement 3: Date Range Filter

**User Story:** As a blockchain analyst, I want to filter events by a date range, so that I can focus on events that occurred within a specific time window.

#### Acceptance Criteria

1. THE EventFiltersBar SHALL render a Start Date input and an End Date input using native HTML date inputs.
2. WHEN a Start Date is set and no End Date is set, THE FilterEngine SHALL include only events whose `receivedAt` is greater than or equal to the StartOfDayUTC of the selected start date.
3. WHEN an End Date is set and no Start Date is set, THE FilterEngine SHALL include only events whose `receivedAt` is less than or equal to the EndOfDayUTC of the selected end date.
4. WHEN both a Start Date and End Date are set, THE FilterEngine SHALL include only events whose `receivedAt` falls within the inclusive range from StartOfDayUTC to EndOfDayUTC.
5. IF a Start Date and End Date are both set and the Start Date is after the End Date, THEN THE FilterEngine SHALL return zero events for the date filter criterion.
6. WHEN neither Start Date nor End Date is set, THE FilterEngine SHALL apply no date restriction.
7. THE EventFiltersBar SHALL render visible labels for both the Start Date and End Date inputs.

---

### Requirement 4: Additive AND Filter Logic

**User Story:** As a blockchain analyst, I want all active filters to apply simultaneously, so that I can narrow results precisely using multiple criteria at once.

#### Acceptance Criteria

1. WHEN multiple filters are active, THE FilterEngine SHALL include only events that satisfy every active filter condition simultaneously (AND logic across filter dimensions).
2. THE FilterEngine SHALL apply the search filter, contract address filter, event type filter, and date range filter as independent, composable predicates.
3. WHEN a filter field holds its default value (`search` is empty, `contractAddress` is `'all'`, `eventTypes` is empty, `startDate` and `endDate` are empty), THE FilterEngine SHALL treat that filter as inactive and not exclude events based on it.

---

### Requirement 5: Clear All Filters

**User Story:** As a blockchain analyst, I want a single button to reset all filters at once, so that I can return to the full unfiltered event list without manually resetting each control.

#### Acceptance Criteria

1. THE EventFiltersBar SHALL render a visible "Clear filters" button.
2. WHEN the "Clear filters" button is activated, THE EventStore SHALL atomically reset `search` to `''`, `contractAddress` to `'all'`, `eventTypes` to an empty set, `startDate` to `''`, and `endDate` to `''` via the ClearAllAction.
3. WHEN the ClearAllAction is dispatched, THE EventExplorer SHALL reset the current page to 1.
4. WHEN all filters are already at their default values, THE EventFiltersBar SHALL render the "Clear filters" button in a visually disabled state.

---

### Requirement 6: Empty State for Zero Filtered Results

**User Story:** As a blockchain analyst, I want a clear message when my filters return no results, so that I understand the list is empty due to active filters rather than a data loading problem.

#### Acceptance Criteria

1. WHEN the FilterEngine returns zero events and at least one filter is active, THE EventExplorer SHALL render a heading containing "No matching events found".
2. WHEN the FilterEngine returns zero events and at least one filter is active, THE EventExplorer SHALL render body text containing "Try adjusting or clearing your filters to see more results."
3. WHEN the FilterEngine returns zero events and no filters are active, THE EventExplorer SHALL render the existing "No events found" empty state.
4. THE EventExplorer SHALL render the empty state region with `role="status"` and `aria-live="polite"` so assistive technologies announce the state change.

---

### Requirement 7: Performance

**User Story:** As a user browsing the Event Explorer, I want filter operations to complete without perceptible lag even when thousands of events are loaded, so that interaction remains smooth.

#### Acceptance Criteria

1. THE EventExplorer SHALL derive the filtered event list using `useMemo`, recomputing only when `events` or `filters` change.
2. WHEN the user types in the search input, THE EventExplorer SHALL not recompute the filtered list until the DebounceInterval has elapsed.
3. WHEN any filter changes, THE EventExplorer SHALL not trigger a full-page reload or re-fetch of events.

---

### Requirement 8: Responsive Filter Panel Layout

**User Story:** As a user on a mobile device, I want the filter controls to stack vertically, so that they are accessible and usable on small screens.

#### Acceptance Criteria

1. WHILE the viewport width is below 768 px, THE EventFiltersBar SHALL render all filter controls in a single-column vertical stack.
2. WHILE the viewport width is 768 px or greater, THE EventFiltersBar SHALL render filter controls in a horizontal row layout.

---

### Requirement 9: Accessibility

**User Story:** As a user relying on assistive technology, I want all filter controls to be labelled and keyboard navigable, so that I can use the Event Explorer without a mouse.

#### Acceptance Criteria

1. THE EventFiltersBar SHALL associate every filter input with a visible `<label>` element using `htmlFor`/`id` pairing or equivalent accessible labelling.
2. THE EventFiltersBar SHALL expose all filter controls as keyboard-focusable and operable via standard keyboard interactions (Tab, Enter, Space).
3. WHEN the filtered event count changes, THE EventExplorer SHALL update an `aria-live="polite"` status region with the current result count so assistive technologies announce the change.
4. WHEN the empty state is rendered, THE EventExplorer SHALL expose it via `role="status"` and `aria-live="polite"` so assistive technologies announce the absence of results.

---

### Requirement 10: Filter Correctness Properties

**User Story:** As a developer maintaining the FilterEngine, I want automated property-based tests covering key correctness invariants, so that regressions are caught early.

#### Acceptance Criteria

1. FOR ALL non-empty search strings `s`, applying the search filter SHALL produce a result set that is a subset of or equal to the unfiltered set (monotone reduction property).
2. FOR ALL combinations of active filters, applying the full filter pipeline twice to the same input SHALL produce the same result as applying it once (idempotence property).
3. FOR ALL event lists and filter states where no filters are active, THE FilterEngine SHALL return all input events unchanged.
4. WHEN a date range `[startDate, endDate]` is applied where `startDate > endDate`, THE FilterEngine SHALL return zero events.
5. FOR ALL event lists, applying a single-type selection to `eventTypes` SHALL return a subset where every event's `type` field equals the selected type.
