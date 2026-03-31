// ─── Layout Shell ──────────────────────────────────────────────
// Tabbed navigation shell for the FlightBrain dashboard.

import { useState } from 'react';
import { Overview } from './Overview';
import { Strategies } from './Strategies';
import { RunHistory } from './RunHistory';
import { Balances } from './Balances';
import { GiftCards } from './GiftCards';
import { FlightSearch } from './FlightSearch';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'strategies', label: 'Strategies' },
  { id: 'runs', label: 'Run History' },
  { id: 'balances', label: 'Balances' },
  { id: 'giftcards', label: 'Gift Cards' },
  { id: 'flights', label: 'Flights' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function Layout() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              FlightBrain
            </h1>
            <div className="text-sm text-gray-500">Dashboard</div>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8 overflow-x-auto" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <TabContent tabId={activeTab} />
      </main>
    </div>
  );
}

function TabContent({ tabId }: { tabId: TabId }) {
  switch (tabId) {
    case 'overview':
      return <Overview />;
    case 'strategies':
      return <Strategies />;
    case 'runs':
      return <RunHistory />;
    case 'balances':
      return <Balances />;
    case 'giftcards':
      return <GiftCards />;
    case 'flights':
      return <FlightSearch />;
  }
}

