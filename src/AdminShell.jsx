const ADMIN_AREAS = [
  { id: 'tableConfig', label: 'Areas and tables', description: 'Configure your dining areas and tables.' },
  { id: 'menuConfig', label: 'Menu', description: 'Manage categories, products and choices.' },
  { id: 'employeeConfig', label: 'Employees', description: 'Manage staff accounts and permissions.' },
  { id: 'orderHistory', label: 'Order history', description: 'Review orders and operational activity.' },
  { id: 'financialVisibility', label: 'Financial information', description: 'Review available payments and business days.' },
  { id: 'operationalReports', label: 'Operational reports', description: 'Explore product, table and waiter activity.' }
];

export function AdminShell({ screen, user, navigate, back, switchUser, children }) {
  return <div className="admin-shell">
    <header className="admin-header">
      <div className="admin-brand"><span className="admin-brand-mark" aria-hidden={true}>A</span><span>Arra <small>Administration</small></span></div>
      <div className="admin-identity"><span>Using PC: <strong>{user || 'Unknown'}</strong></span><button className="admin-button admin-button-light" onClick={switchUser}>Switch user</button></div>
    </header>
    <div className="admin-layout">
      <aside className="admin-sidebar"><button className="admin-return" onClick={back}>← Back to tables</button>
        <nav aria-label="Administration"><p className="admin-nav-label">WORKSPACE</p>
          <button className="admin-nav-item" aria-current={screen === 'admin' ? 'page' : undefined} onClick={() => navigate('admin')}>Overview</button>
          {ADMIN_AREAS.map(a => <button key={a.id} className="admin-nav-item" aria-current={screen === a.id ? 'page' : undefined} onClick={() => navigate(a.id)}>{a.label}</button>)}
        </nav>
      </aside>
      <div className="admin-content">{screen === 'admin' ?
        <main className="admin-overview"><p className="admin-eyebrow">ARRA POS / ADMINISTRATION</p><h1>Administration</h1>
          <p className="admin-intro">Choose an area to manage your restaurant or review its activity.</p>
          <p className="admin-access-note">Access depends on your signed-in account and selected identity. An area may be unavailable if you do not have permission.</p>
          <div className="admin-cards">{ADMIN_AREAS.map(a => <button key={a.id} className="admin-card" onClick={() => navigate(a.id)}><span className="admin-card-icon" aria-hidden={true}>↗</span><strong>{a.label}</strong><span>{a.description}</span><span className="admin-card-link">Open area →</span></button>)}</div>
        </main> : children}</div>
    </div>
  </div>;
}
