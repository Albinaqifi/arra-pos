import { shellText } from "./admin/shell-i18n.js";
const ADMIN_AREAS = [
  { id: 'tableConfig', label: 'Areas and tables', description: 'Configure your dining areas and tables.' },
  { id: 'menuConfig', label: 'Menu', description: 'Manage categories, products and choices.' },
  { id: 'employeeConfig', label: 'Employees', description: 'Manage staff accounts and permissions.' },
  { id: 'orderHistory', label: 'Order history', description: 'Review orders and operational activity.' },
  { id: 'adminSentCorrections', label: 'Correct sent items', description: 'Review unbilled open orders and correct sent items.' },
  { id: 'financialVisibility', label: 'Financial information', description: 'Review available payments and business days.' },
  { id: 'operationalReports', label: 'Operational reports', description: 'Explore product, table and waiter activity.' }
];

export function AdminShell({ screen, user, language, navigate, back, switchUser, directOwner, children }) {
  const t = key => shellText(language, key);
  return <div className="admin-shell">
    <header className="admin-header">
      <div className="admin-brand"><span className="admin-brand-mark" aria-hidden={true}>A</span><span>Arra <small>{t("Administration")}</small></span></div>
      <div className="admin-identity"><span>{t("Using PC:")} <strong>{user || t('Unknown')}</strong></span><button className="admin-button admin-button-light" onClick={switchUser}>{t(directOwner ? "Sign out" : "Switch user")}</button></div>
    </header>
    <div className="admin-layout">
      <aside className="admin-sidebar"><button className="admin-return" onClick={back}>{t(directOwner ? "← Sign out" : "← Back to tables")}</button>
        <nav aria-label={t("Administration")}><p className="admin-nav-label">{t("WORKSPACE")}</p>
          <button className="admin-nav-item" aria-current={screen === 'admin' ? 'page' : undefined} onClick={() => navigate('admin')}>{t("Overview")}</button>
          {ADMIN_AREAS.map(a => <button key={a.id} className="admin-nav-item" aria-current={screen === a.id ? 'page' : undefined} onClick={() => navigate(a.id)}>{t(a.label)}</button>)}
        </nav>
      </aside>
      <div className="admin-content">{screen === 'admin' ?
        <main className="admin-overview"><p className="admin-eyebrow">{t("ARRA POS / ADMINISTRATION")}</p><h1>{t("Administration")}</h1>
          <p className="admin-intro">{t("Choose an area to manage your restaurant or review its activity.")}</p>
          <p className="admin-access-note">{t("Access depends on your signed-in account and selected identity. An area may be unavailable if you do not have permission.")}</p>
          <div className="admin-cards">{ADMIN_AREAS.map(a => <button key={a.id} className="admin-card" onClick={() => navigate(a.id)}><span className="admin-card-icon" aria-hidden={true}>↗</span><strong>{t(a.label)}</strong><span>{t(a.description)}</span><span className="admin-card-link">{t("Open area →")}</span></button>)}</div>
          {children}
        </main> : children}</div>
    </div>
  </div>;
}
