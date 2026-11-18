const sq = {
  'Areas and tables':'Hapesirat dhe tavolinat', 'Configure your dining areas and tables.':'Konfiguroni hapesirat dhe tavolinat e restorantit.',
  'Menu':'Menyja', 'Manage categories, products and choices.':'Menaxhoni kategorite, produktet dhe opsionet.',
  'Employees':'Punonjesit', 'Manage staff accounts and permissions.':'Menaxhoni llogarite dhe lejet e stafit.',
  'Order history':'Historiku i porosive', 'Review orders and operational activity.':'Shqyrtoni porosite dhe aktivitetin operacional.',
  'Correct sent items':'Korrigjo artikujt e derguar', 'Review unbilled open orders and correct sent items.':'Shqyrtoni porosite e hapura pa fature dhe korrigjoni artikujt e derguar.',
  'Assign existing orders':'Cakto porosite ekzistuese', 'Assign unowned orders from before the upgrade.':'Caktoni porosite pa kamerier nga para perditesimit.',
  'Financial information':'Informacioni financiar', 'Review available payments and business days.':'Shqyrtoni pagesat e disponueshme dhe ditet e punes.',
  'Operational reports':'Raportet operacionale', 'Explore product, table and waiter activity.':'Shqyrtoni aktivitetin e produkteve, tavolinave dhe kameriereve.',
  'Administration':'Administrimi', 'Unknown':'I panjohur', 'Using PC:':'Perdor kompjuterin:', 'Switch user':'Ndrysho perdoruesin',
  '← Back to tables':'← Kthehu te tavolinat', 'Sign out':'Dil', '← Sign out':'← Dil', 'WORKSPACE':'HAPESIRA E PUNES', 'Overview':'Permbledhje', 'ARRA POS / ADMINISTRATION':'ARRA POS / ADMINISTRIMI',
  'Choose an area to manage your restaurant or review its activity.':'Zgjidhni nje fushe per te menaxhuar restorantin ose per te shqyrtuar aktivitetin e tij.',
  'Access depends on your signed-in account and selected identity. An area may be unavailable if you do not have permission.':'Qasja varet nga llogaria e hyre dhe identiteti i zgjedhur. Nje fushe mund te mos jete e disponueshme nese nuk keni leje.',
  'Open area →':'Hap fushen →'
};
export const shellText = (language, key) => language === 'sq' ? (sq[key] ?? key) : key;
