import { useState } from 'react';
import { EventExplorerPage } from './pages/EventExplorerPage';
import { ExportHistoryPage } from './pages/ExportHistoryPage';

export function App() {
  const [activeTab, setActiveTab] = useState<'explorer' | 'exports'>('explorer');

  return (
    <div className="app">
      <nav className="nav-header">
        <span className="nav-brand">Notify-Chain</span>
        <div className="nav-tabs">
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'explorer' ? 'nav-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('explorer')}
          >
            Event Explorer
          </button>
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'exports' ? 'nav-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('exports')}
          >
            Export Center
          </button>
        </div>
      </nav>

      {activeTab === 'explorer' ? <EventExplorerPage /> : <ExportHistoryPage />}
import { NotificationTimelineView } from './components/NotificationTimelineView';

type Tab = 'explorer' | 'timeline';

export function App() {
  const [tab, setTab] = useState<Tab>('explorer');

  return (
    <div className="app">
      <nav className="app-tabs" role="tablist" aria-label="Main navigation">
        <button
          role="tab"
          aria-selected={tab === 'explorer'}
          className={`app-tabs__btn${tab === 'explorer' ? ' app-tabs__btn--active' : ''}`}
          onClick={() => setTab('explorer')}
        >
          Event Explorer
        </button>
        <button
          role="tab"
          aria-selected={tab === 'timeline'}
          className={`app-tabs__btn${tab === 'timeline' ? ' app-tabs__btn--active' : ''}`}
          onClick={() => setTab('timeline')}
        >
          Delivery Timeline
        </button>
      </nav>

      {tab === 'explorer' && <EventExplorerPage />}
      {tab === 'timeline' && <NotificationTimelineView />}
    </div>
  );
}
