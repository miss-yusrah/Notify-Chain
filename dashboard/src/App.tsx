/**
 * App.tsx — root shell; layout delegated to DashboardLayout (#676).
 */

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import { EventExplorerPage } from './pages/EventExplorerPage';
import { NotificationTimelineView } from './components/NotificationTimelineView';
import { ActivityFeed } from './components/ActivityFeed';
import { UserActivityTimeline } from './components/UserActivityTimeline';
import { RetryStatisticsPanel } from './components/RetryStatisticsPanel';
import { WebhookDashboardPage } from './pages/WebhookDashboardPage';
import { ExportHistoryPage } from './pages/ExportHistoryPage';
import { NotificationSearchPage } from './pages/NotificationSearchPage';
import { NotificationPreferencesPage } from './pages/NotificationPreferencesPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { ThemeToggle } from './components/ThemeToggle';
import { MobileNavDrawer, NAV_ITEMS, type Tab } from './components/MobileNavDrawer';
import { ToastProvider } from './context/ToastContext';
import { useTheme } from './hooks/useTheme';
import { useIsMobileNav } from './hooks/useMediaQuery';
import { DeliveryHeatmap } from './components/DeliveryHeatmap';
import { useEventStore } from './store/eventStore';
import { SyncStatus } from './components/SyncStatus';
import { DashboardLayout } from './layouts/DashboardLayout';

export function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const hash = window.location.hash.slice(1);
    if (NAV_ITEMS.some((item) => item.id === hash)) {
      return hash as Tab;
    }
    return 'explorer';
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobileNav = useIsMobileNav();
  const { theme, toggleTheme } = useTheme();
  const events = useEventStore((state) => state.events);
  const tabListRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // Sync URL hash with tab state
  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  // Sync tab state with URL hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (NAV_ITEMS.some((item) => item.id === hash)) {
        setTab(hash as Tab);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Close mobile drawer when the viewport crosses into desktop layout so
  // hidden overlay/focus-trap state does not linger after a resize (#681).
  useEffect(() => {
    if (!isMobileNav && drawerOpen) {
      setDrawerOpen(false);
    }
  }, [isMobileNav, drawerOpen]);

  const handleTabKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const current = tabs.findIndex((el) => el === document.activeElement);

    let next = current;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      next = (current + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      next = (current - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      next = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      next = tabs.length - 1;
    }

    if (next !== current) {
      tabs[next]?.focus();
      const navItem = NAV_ITEMS[next];
      if (navItem) setTab(navItem.id);
    }
  }, []);

  const handleDrawerOpen = useCallback(() => setDrawerOpen(true), []);
  const handleDrawerClose = useCallback(() => setDrawerOpen(false), []);

  return (
    <ToastProvider>
      <DashboardLayout
        activeTab={tab}
        onSelectTab={setTab}
        drawerOpen={drawerOpen}
        onDrawerOpen={handleDrawerOpen}
        onDrawerClose={handleDrawerClose}
        tabListRef={tabListRef}
        hamburgerRef={hamburgerRef}
        onTabKeyDown={handleTabKeyDown}
        themeBar={
          <>
            <SyncStatus />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </>
        }
      >
        {NAV_ITEMS.map((item) => (
          <div
            key={item.id}
            role="tabpanel"
            id={`panel-${item.id}`}
            aria-labelledby={`tab-${item.id}`}
            hidden={tab !== item.id}
            className="app__panel"
          >
            {tab === item.id && renderPanel(item.id, events)}
          </div>
        ))}
      </DashboardLayout>

      <MobileNavDrawer
        isOpen={drawerOpen}
        onClose={handleDrawerClose}
        activeTab={tab}
        onSelectTab={(t) => {
          setTab(t);
          handleDrawerClose();
        }}
      />
    </ToastProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPanel(tab: Tab, events: any[]) {
  switch (tab) {
    case 'explorer':
      return (
        <>
          <EventExplorerPage />
          <DeliveryHeatmap events={events} />
        </>
      );
    case 'timeline':
      return <NotificationTimelineView />;
    case 'activity':
      return <ActivityFeed />;
    case 'user-activity':
      return <UserActivityTimeline />;
    case 'retry-stats':
      return <RetryStatisticsPanel />;
    case 'webhooks':
      return <WebhookDashboardPage />;
    case 'export-history':
      return <ExportHistoryPage />;
    case 'search':
      return <NotificationSearchPage />;
    case 'preferences':
      return <NotificationPreferencesPage />;
    case 'templates':
      return <TemplatesPage />;
    default:
      return null;
  }
}
