# Requirements: Event Explorer Advanced Filters

## Overview

Enhance the Event Explorer page with an advanced, multi-dimensional filter panel. Users must be able to combine a debounced contract-ID text search, a multi-select event-type filter, and a date-range picker to instantly isolate smart contract events — all without a page reload.

---

## Requirements

### 1. Debounced Contract ID / Text Search

**User Story:** As a user, I want to type a contract address or keyword into a search field and see results update automatically, so that I can locate specific events without the UI freezing on every keystroke.

#### Acceptance Criteria

- 1.1 A text input labelled "Search" accepts free-text and searches across `contractAddress`, `eventId`, `eventName`, and `txHash` fields.
- 1.2 The visible input value updates on every keystroke (controlled input); the filter state in the store updates only after 300 ms of inactivity (debounce).
- 1.3 Clearing the input resets the search filter immediately (on clear/empty, the debounce fires at once or the value is applied on blur-clear).
- 1.4 Typing rapidly (e.g., 10 characters in 200 ms) triggers the store update exactly **once** after the 300 ms window, not once per character.

---

### 2. Event Type Multi-Select Filter

**User Story:** As a user, I want to filter events by one or more event-type classifications simultaneously, so that I can compare or isolate multiple categories at once.

#### Acceptance Criteria

- 2.1 The filter panel exposes the distinct values of `BlockchainEvent.type` (e.g., `contract`, `system`, `diagnostic`) as individually toggleable controls (button group or multi-select).
- 2.2 When no type is selected, all events are shown (equivalent to "All types").
- 2.3 When one or more types are selected, only events whose `type` matches **any** selected value are shown (OR logic within the type set).
- 2.4 Selecting and deselecting a type updates the filtered list immediately (subject to the overall AND logic with other active filters).
- 2.5 The current selection is visually indicated (e.g., active/pressed button state or checked option).

---

### 3. Date Range Filter

**User Story:** As a user, I want to specify a start date and/or end date so that only events received within that window are shown.

#### Acceptance Criteria

- 3.1 The filter panel includes a "From" date input and a "To" date input (native `<input type="date">` is acceptable).
- 3.2 The "From" date is treated as the **start of that calendar day in UTC** (00:00:00.000 UTC).
- 3.3 The "To" date is treated as the **end of that calendar day in UTC** (23:59:59.999 UTC).
- 3.4 Setting only "From" shows all events from that date onwards.
- 3.5 Setting only "To" shows all events up to and including that date.
- 3.6 Setting both constrains events to the inclusive range [start-of-From, end-of-To].
- 3.7 If "From" is set to a date **after** "To", the result set is empty and a validation hint is shown (e.g., "Start date must be before end date").
- 3.8 Clearing either date input removes that bound immediately.

---

### 4. Additive AND Filter Logic

**User Story:** As a user, I want all my active filters to work together, so that I always see events that match every criteria I've set.

#### Acceptance Criteria

- 4.1 An event appears in the results only when it passes **all** active filters simultaneously (search AND selected event types AND date range).
- 4.2 Adding a new filter dimension never widens the result set — it can only narrow or maintain it.
- 4.3 The existing `filterEvents` utility is extended (not replaced) to accept the new filter dimensions.

---

### 5. Clear All Filters

**User Story:** As a user, I want a single button to reset all filters at once, so that I can return to the full event list without manually clearing each control.

#### Acceptance Criteria

- 5.1 A "Clear filters" button is visible in the filter panel whenever **any** filter deviates from its default state.
- 5.2 Clicking it resets: search text to `""`, contractAddress to `"all"`, event type selection to none/all, startDate and endDate to empty.
- 5.3 The pagination page resets to 1 on clear.
- 5.4 The button is hidden (or disabled) when all filters are already at their defaults.

---

### 6. Empty State

**User Story:** As a user, when my filter combination returns no results, I want a clear message explaining what happened and how to recover.

#### Acceptance Criteria

- 6.1 When the filtered result set is empty, the table/card area is replaced by an empty-state section.
- 6.2 The empty state reads: heading **"No matching events found"** and body **"Try adjusting or clearing your filters to see more results."**
- 6.3 The empty-state section uses `role="status"` and `aria-live="polite"` so screen readers announce it.
- 6.4 A shortcut "Clear filters" link/button inside the empty state triggers the same reset as Requirement 5.

---

### 7. Performance

**User Story:** As a user, I expect filtering to feel instant even with thousands of events loaded.

#### Acceptance Criteria

- 7.1 The derived filtered event list is computed via `useMemo`, re-evaluating only when `events` or any filter value changes.
- 7.2 Filter state changes never trigger a network request or a full page reload.
- 7.3 The debounce on the text search input (Requirement 1) prevents redundant re-computations from rapid typing.

---

### 8. Responsive Layout

**User Story:** As a user on a mobile device, I want the filter controls to be usable and not overflow the screen.

#### Acceptance Criteria

- 8.1 On viewports narrower than 768 px the filter controls stack into a single vertical column.
- 8.2 On viewports 768 px and wider the controls lay out horizontally in a single row or a compact grid.
- 8.3 No filter control overflows or clips its label at any tested breakpoint.

---

### 9. Accessibility

**User Story:** As a keyboard or screen-reader user, I want to fully operate all filter controls without a mouse.

#### Acceptance Criteria

- 9.1 Every filter input has a programmatically associated `<label>` (via `htmlFor`/`id` pairing).
- 9.2 The result count (e.g., "Showing 1–12 of 47 events") updates in an `aria-live="polite"` region.
- 9.3 The empty-state region is announced by screen readers when it appears (see 6.3).
- 9.4 All interactive controls (inputs, selects, buttons) are reachable and operable via keyboard Tab / Enter / Space navigation.
- 9.5 The filter panel passes an automated axe accessibility audit with zero violations.

---

### 10. Test Coverage

**User Story:** As a developer, I want automated tests to verify all new filter behaviour so that regressions are caught immediately.

#### Acceptance Criteria

- 10.1 **Debounce test:** typing 5+ characters rapidly triggers the store's search action exactly once after the debounce window, not on each keystroke.
- 10.2 **Multi-filter intersection test:** seeding the store with a known event set and applying a Contract ID + Event Type + Date Range combination returns only the records that satisfy all three criteria.
- 10.3 **Clear All test:** after applying at least two filters, clicking "Clear filters" causes the rendered list to return to the full unfiltered count.
- 10.4 **Empty state test:** a filter combination that matches zero events renders the "No matching events found" heading.
- 10.5 **Accessibility test:** the filter panel passes `jest-axe` with no violations.
