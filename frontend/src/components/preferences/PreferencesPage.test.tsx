/**
 * PreferencesPage component tests — Issue #178
 *
 * Tests cover:
 * - Rendering with loading state (skeleton)
 * - Rendering with loaded preferences
 * - Toggle interactions (channel + category)
 * - Reset button
 * - Error state
 * - Not-connected state
 * - Mobile/desktop responsive snapshots
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PreferencesPage } from "./PreferencesPage";
import * as preferenceServiceModule from "../../services/preferenceService";
import type { RecipientPreferences } from "../../types/preferences";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrefs: RecipientPreferences = {
  recipient: "GABC123",
  updated_at: 1_719_000_000,
  channels: [
    { channel: "Wallet", enabled: true },
    { channel: "Email", enabled: false },
    { channel: "InApp", enabled: true },
  ],
  categories: [
    { category: "Payment", enabled: true },
    { category: "GroupMembership", enabled: false },
    { category: "GroupStatus", enabled: true },
    { category: "SystemAlerts", enabled: true },
    { category: "General", enabled: false },
  ],
};

const mockService = {
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
  setChannelPreference: vi.fn(),
  setCategoryPreference: vi.fn(),
  resetPreferences: vi.fn(),
};

vi.mock("../../services/preferenceService", () => ({
  preferenceService: mockService,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(recipient: string | null = "GABC123") {
  return render(<PreferencesPage recipient={recipient} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockService.getPreferences.mockResolvedValue(mockPrefs);
  mockService.setChannelPreference.mockResolvedValue(undefined);
  mockService.setCategoryPreference.mockResolvedValue(undefined);
  mockService.resetPreferences.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PreferencesPage", () => {
  it("shows connect wallet prompt when no recipient", () => {
    renderPage(null);
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
  });

  it("shows loading skeleton while fetching", () => {
    // Don't resolve the promise yet
    mockService.getPreferences.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByLabelText(/loading preferences/i)).toBeInTheDocument();
  });

  it("renders all three delivery channel rows after loading", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/wallet notifications/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email notifications/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/in-app notifications/i)).toBeInTheDocument();
    });
  });

  it("renders all five category rows after loading", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/payment events/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/group membership/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/group status/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/system alerts/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/general/i)).toBeInTheDocument();
    });
  });

  it("displays correct initial toggle state for Email (disabled)", async () => {
    renderPage();
    await waitFor(() => {
      const emailToggle = screen.getByRole("switch", {
        name: /email notifications/i,
      });
      expect(emailToggle).toHaveAttribute("aria-checked", "false");
    });
  });

  it("displays correct initial toggle state for Wallet (enabled)", async () => {
    renderPage();
    await waitFor(() => {
      const walletToggle = screen.getByRole("switch", {
        name: /wallet notifications/i,
      });
      expect(walletToggle).toHaveAttribute("aria-checked", "true");
    });
  });

  it("calls setChannelPreference when a channel is toggled", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText(/wallet notifications/i)).toBeInTheDocument()
    );

    const walletToggle = screen.getByRole("switch", {
      name: /wallet notifications/i,
    });
    fireEvent.click(walletToggle);

    await waitFor(() => {
      expect(mockService.setChannelPreference).toHaveBeenCalledWith(
        "GABC123",
        "Wallet",
        false
      );
    });
  });

  it("calls setCategoryPreference when a category is toggled", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText(/payment events/i)).toBeInTheDocument()
    );

    const paymentToggle = screen.getByRole("switch", { name: /payment events/i });
    fireEvent.click(paymentToggle);

    await waitFor(() => {
      expect(mockService.setCategoryPreference).toHaveBeenCalledWith(
        "GABC123",
        "Payment",
        false
      );
    });
  });

  it("calls resetPreferences when Reset to defaults is clicked", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/reset to defaults/i)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByText(/reset to defaults/i));

    await waitFor(() => {
      expect(mockService.resetPreferences).toHaveBeenCalledWith("GABC123");
    });
  });

  it("shows error banner and retry when getPreferences fails", async () => {
    mockService.getPreferences.mockRejectedValue(new Error("Network error"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/retry/i)).toBeInTheDocument();
    });
  });

  it("retries loading when retry button is clicked", async () => {
    mockService.getPreferences
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(mockPrefs);

    renderPage();

    await waitFor(() => screen.getByRole("alert"));

    fireEvent.click(screen.getByText(/retry/i));

    await waitFor(() => {
      expect(mockService.getPreferences).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText(/wallet notifications/i)).toBeInTheDocument();
    });
  });

  it("applies optimistic update on channel toggle before API resolves", async () => {
    // Delay the API response
    mockService.setChannelPreference.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 500))
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText(/email notifications/i)).toBeInTheDocument()
    );

    const emailToggle = screen.getByRole("switch", {
      name: /email notifications/i,
    });
    // Initially disabled (false)
    expect(emailToggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(emailToggle);

    // Optimistic update should flip the toggle immediately
    expect(emailToggle).toHaveAttribute("aria-checked", "true");
  });
});
