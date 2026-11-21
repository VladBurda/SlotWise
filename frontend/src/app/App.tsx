import { useState } from 'react';
import {
  CalendarDays,
  LayoutDashboard,
  ClipboardList,
  Users,
  Boxes,
  Sparkles,
  Contact,
  ListOrdered,
  ChartNoAxesCombined,
  Settings,
  PanelLeftClose,
  Menu,
  Layers,
  ShieldCheck,
  BookOpen,
  Clock3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SystemStatus } from '@/features/system/SystemStatus';

const navigation = [
  { name: 'Overview', icon: LayoutDashboard, phase: 1 },
  { name: 'Calendar', icon: CalendarDays, phase: 6 },
  { name: 'Appointments', icon: ClipboardList, phase: 5 },
  { name: 'Staff', icon: Users, phase: 4 },
  { name: 'Resources', icon: Boxes, phase: 4 },
  { name: 'Services', icon: Sparkles, phase: 4 },
  { name: 'Customers', icon: Contact, phase: 7 },
  { name: 'Waitlist', icon: ListOrdered, phase: 8 },
  { name: 'Analytics', icon: ChartNoAxesCombined, phase: 10 },
  { name: 'Settings', icon: Settings, phase: 3 },
];

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        className={menuOpen ? 'sidebar open' : 'sidebar'}
        aria-label="Main navigation"
      >
        <a className="brand" href="/">
          <span className="brand-mark">
            <Layers size={24} />
          </span>
          slotwise<span className="brand-dot">.</span>
        </a>
        <div className="workspace-card">
          <span className="workspace-avatar">SW</span>
          <div>
            <strong>Your workspace</strong>
            <small>
              <a href="/app">Open your workspace</a>
            </small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {navigation.map(({ name, icon: Icon, phase }) =>
            phase === 1 ? (
              <a
                key={name}
                href="/"
                aria-current="page"
                className="nav-item active"
              >
                <Icon size={19} />
                {name}
              </a>
            ) : (
              <div
                key={name}
                className="nav-item planned"
                aria-disabled="true"
                title={`Planned for Phase ${phase}`}
              >
                <Icon size={19} />
                <span>{name}</span>
                <span className="nav-phase">P{phase}</span>
              </div>
            ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="badge success">Phase 1 · Foundation</span>
          <p>
            Good scheduling starts
            <br />
            with a solid foundation.
          </p>
          <button className="mobile-close" onClick={() => setMenuOpen(false)}>
            <PanelLeftClose size={18} />
            Close menu
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="backdrop"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="menu-toggle"
              aria-label="Open navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>Overview</strong>
          </div>
          <span className="environment">
            <a href="/account/login">Sign in</a>
            <a href="/account/register">Create account</a>
          </span>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR SCHEDULING WORKSPACE</p>
              <h1>
                A little more organized.
                <br />
                <span>A lot more possible.</span>
              </h1>
              <p>A shared home for your people, resources, and appointments.</p>
            </div>
            <span className="version-tag">
              FOUNDATION <strong>v0.1</strong>
            </span>
          </div>
          <section className="welcome-card" aria-labelledby="welcome-title">
            <div className="welcome-copy">
              <span className="light-label">LET’S BUILD YOUR WORKDAY</span>
              <h2 id="welcome-title">
                The right time.
                <br />
                The right resources.
              </h2>
              <p>
                Your workspace foundation is in place. Create a secure account,
                set up your workspace, and invite your team.
              </p>
              <Button asChild variant="outline">
                <a href="/api/docs" target="_blank" rel="noreferrer">
                  <BookOpen size={16} />
                  Explore the API
                </a>
              </Button>
            </div>
            <div className="schedule-art" aria-hidden="true">
              <div className="art-title">
                <span />
                <span />
                <span />
              </div>
              <div className="art-grid">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <div className="art-slot one">
                  <Users size={17} />
                  <span>People</span>
                </div>
                <div className="art-slot two">
                  <Boxes size={17} />
                  <span>Resources</span>
                </div>
                <div className="art-slot three">
                  <CalendarDays size={17} />
                  <span>In sync</span>
                  <CheckCircle />
                </div>
              </div>
              <span className="art-caption">EVERYTHING HAS ITS PLACE</span>
            </div>
          </section>
          <div className="overview-grid">
            <SystemStatus />
            <section className="panel next-panel">
              <p className="eyebrow">UP NEXT</p>
              <h2>Make it your workspace</h2>
              <p>Bring your business and team into SlotWise.</p>
              <ol className="steps">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Create your account</strong>
                    <small>Secure sign-in and verified email</small>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Set up your workspace</strong>
                    <small>One home for your business</small>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Bring your team together</strong>
                    <small>Invitations and role-based access</small>
                  </div>
                </li>
              </ol>
              <div className="phase-note">
                <Clock3 size={16} />
                <a href="/app">Set up your workspace</a>
              </div>
            </section>
          </div>
          <section
            className="principles"
            aria-label="Platform design principles"
          >
            <div>
              <ShieldCheck />
              <span>
                <strong>Isolated by design</strong>
                <small>Workspace boundaries at every layer</small>
              </span>
            </div>
            <div>
              <Boxes />
              <span>
                <strong>Resources, together</strong>
                <small>People, rooms, and equipment in sync</small>
              </span>
            </div>
            <div>
              <CalendarDays />
              <span>
                <strong>Correctness comes first</strong>
                <small>Transactional booking is the next foundation</small>
              </span>
            </div>
          </section>
          <footer>
            SlotWise <span>Thoughtful scheduling. Built step by step.</span>
            <span>Phase 1 · No booking data yet</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function CheckCircle() {
  return <span className="art-check">✓</span>;
}
