// ─── Layout Shell ──────────────────────────────────────────────
// Dark-themed tabbed navigation shell for the FlightBrain dashboard.
// Responsive: horizontal tabs on md+, hamburger drawer on mobile.

import { useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { Overview } from './Overview';
import { Strategies } from './Strategies';
import { RunHistory } from './RunHistory';
import { Balances } from './Balances';
import { GiftCards } from './GiftCards';
import { FlightSearch } from './FlightSearch';
import { Hotels } from './Hotels';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'strategies', label: 'Strategies' },
  { id: 'runs', label: 'Run History' },
  { id: 'balances', label: 'Balances' },
  { id: 'giftcards', label: 'Gift Cards' },
  { id: 'flights', label: 'Flights' },
  { id: 'hotels', label: 'Hotels' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function Layout() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const selectTab = (id: TabId) => {
    setActiveTab(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-surface font-sans">
      {/* Skip nav */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-white focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Header */}
      <header className="bg-surface-raised border-b border-slate-700/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-bold text-white tracking-tight">
              Flight<span className="text-accent">Brain</span>
            </h1>

            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden inline-flex items-center justify-center rounded-md p-2 text-muted hover:text-white hover:bg-surface-overlay transition-colors focus:outline-none focus:ring-2 focus:ring-accent"
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? (
                // X icon
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                // Hamburger icon
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              )}
            </button>

            <div className="hidden md:block text-sm text-muted">Dashboard</div>
          </div>
        </div>
      </header>

      {/* Desktop tab bar */}
      <nav className="hidden md:block bg-surface-raised border-b border-slate-700/60" aria-label="Dashboard tabs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8 overflow-x-auto" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => selectTab(tab.id)}
                className={`whitespace-nowrap py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted hover:text-muted-strong hover:border-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Mobile drawer menu */}
      {mobileMenuOpen && (
        <nav className="md:hidden bg-surface-raised border-b border-slate-700/60" aria-label="Mobile navigation">
          <div className="px-4 py-2 space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                className={`block w-full text-left rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted hover:text-white hover:bg-surface-overlay'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Content */}
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ErrorBoundary key={activeTab}>
          <TabContent tabId={activeTab} />
        </ErrorBoundary>
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
    case 'hotels':
      return <Hotels />;
  }
}
