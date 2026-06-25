/**
 * PreferencesPage – Notification Preferences Management Interface
 *
 * Implements Issue #178:
 * - Toggles for notification categories
 * - Support for Email, Wallet, and In-App delivery channels
 * - Displays current preference status
 * - Loading and error states
 * - Responsive mobile + desktop layout
 * - Connects to backend preference APIs via usePreferences hook
 */
import React, { useCallback } from "react";
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  CHANNEL_DESCRIPTIONS,
  CHANNEL_LABELS,
  type CategoryPreference,
  type ChannelPreference,
  type DeliveryChannel,
  type NotificationCategory,
} from "../../types/preferences";
import { usePreferences } from "../../hooks/usePreferences";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id: string;
}

/** Accessible toggle switch */
function Toggle({ checked, onChange, label, disabled = false, id }: ToggleProps) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent",
        "transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
        checked ? "bg-indigo-600" : "bg-gray-200",
        disabled ? "cursor-not-allowed opacity-50" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0",
          "transition duration-200 ease-in-out",
          checked ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

interface PreferenceRowProps {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  loading?: boolean;
}

function PreferenceRow({
  id,
  label,
  description,
  enabled,
  onToggle,
  loading = false,
}: PreferenceRowProps) {
  return (
    <div className="flex items-start justify-between py-4 sm:py-5">
      <div className="flex flex-col pr-4">
        <label
          htmlFor={id}
          className="text-sm font-medium text-gray-900 dark:text-gray-100"
        >
          {label}
        </label>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      <div className="mt-1 flex-shrink-0">
        <Toggle
          id={id}
          label={label}
          checked={enabled}
          onChange={onToggle}
          disabled={loading}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <div className="flex items-start justify-between py-4 sm:py-5 animate-pulse">
      <div className="flex flex-col gap-2 flex-1 pr-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-40" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-64" />
      </div>
      <div className="h-6 w-11 bg-gray-200 dark:bg-gray-700 rounded-full flex-shrink-0 mt-1" />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading preferences">
      {[...Array(3)].map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

interface ErrorBannerProps {
  message: string;
  onRetry: () => void;
}

function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="rounded-md bg-red-50 dark:bg-red-900/30 p-4 mb-4"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
        <button
          onClick={onRetry}
          className="text-sm font-medium text-red-700 dark:text-red-300 underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 px-4 sm:px-6 mb-6">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white pt-4 sm:pt-5 pb-2 border-b border-gray-100 dark:border-gray-700">
        {title}
      </h2>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export interface PreferencesPageProps {
  /** Connected wallet address (Stellar public key) */
  recipient: string | null;
}

export function PreferencesPage({ recipient }: PreferencesPageProps) {
  const { state, refresh, setChannel, setCategory, reset } = usePreferences(recipient);

  const handleChannelToggle = useCallback(
    (channel: DeliveryChannel) => async (enabled: boolean) => {
      await setChannel(channel, enabled);
    },
    [setChannel]
  );

  const handleCategoryToggle = useCallback(
    (category: NotificationCategory) => async (enabled: boolean) => {
      await setCategory(category, enabled);
    },
    [setCategory]
  );

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!recipient) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10 sm:px-6">
        <div className="text-center py-16">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
            />
          </svg>
          <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
            Connect your wallet
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Connect your Stellar wallet to manage your notification preferences.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 sm:px-6 sm:py-10">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
          Notification Preferences
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Control how and when you receive notifications from Notify-Chain.
        </p>
      </div>

      {/* Error state */}
      {state.status === "error" && (
        <ErrorBanner message={state.error} onRetry={refresh} />
      )}

      {/* Delivery Channels */}
      <Section title="Delivery Channels">
        {state.status === "loading" ? (
          <LoadingSkeleton />
        ) : state.status === "success" ? (
          (["Wallet", "Email", "InApp"] as DeliveryChannel[]).map((channel) => {
            const pref = state.data.channels.find((c) => c.channel === channel);
            return (
              <PreferenceRow
                key={channel}
                id={`channel-${channel}`}
                label={CHANNEL_LABELS[channel]}
                description={CHANNEL_DESCRIPTIONS[channel]}
                enabled={pref?.enabled ?? true}
                onToggle={handleChannelToggle(channel)}
              />
            );
          })
        ) : (
          <LoadingSkeleton />
        )}
      </Section>

      {/* Notification Categories */}
      <Section title="Notification Categories">
        {state.status === "loading" ? (
          <LoadingSkeleton />
        ) : state.status === "success" ? (
          (
            [
              "Payment",
              "GroupMembership",
              "GroupStatus",
              "SystemAlerts",
              "General",
            ] as NotificationCategory[]
          ).map((category) => {
            const pref = state.data.categories.find((c) => c.category === category);
            return (
              <PreferenceRow
                key={category}
                id={`category-${category}`}
                label={CATEGORY_LABELS[category]}
                description={CATEGORY_DESCRIPTIONS[category]}
                enabled={pref?.enabled ?? true}
                onToggle={handleCategoryToggle(category)}
              />
            );
          })
        ) : (
          <LoadingSkeleton />
        )}
      </Section>

      {/* Footer actions */}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between sm:items-center mt-2">
        {/* Last updated */}
        {state.status === "success" && (
          <p className="text-xs text-gray-400 text-center sm:text-left">
            Last updated:{" "}
            {new Date(state.data.updated_at * 1000).toLocaleString()}
          </p>
        )}

        {/* Reset button */}
        <button
          onClick={() => reset()}
          disabled={state.status === "loading"}
          className={[
            "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium",
            "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300",
            "hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500",
            "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          Reset to defaults
        </button>
      </div>
    </main>
  );
}

export default PreferencesPage;
