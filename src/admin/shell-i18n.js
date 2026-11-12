const sq = {
  'Areas and tables':'Hapësirat dhe tavolinat', 'Configure your dining areas and tables.':'Konfiguroni hapësirat dhe tavolinat e restorantit.',
  'Menu':'Menyja', 'Manage categories, products and choices.':'Menaxhoni kategoritë, produktet dhe opsionet.',
  'Employees':'Punonjësit', 'Manage staff accounts and permissions.':'Menaxhoni llogaritë dhe lejet e stafit.',
  'Order history':'Historiku i porosive', 'Review orders and operational activity.':'Shqyrtoni porositë dhe aktivitetin operacional.',
  'Financial information':'Informacioni financiar', 'Review available payments and business days.':'Shqyrtoni pagesat e disponueshme dhe ditët e punës.',
  'Operational reports':'Raportet operacionale', 'Explore product, table and waiter activity.':'Shqyrtoni aktivitetin e produkteve, tavolinave dhe kamerierëve.',
  'Administration':'Administrimi', 'Unknown':'I panjohur', 'Using PC:':'Përdor kompjuterin:', 'Switch user':'Ndrysho përdoruesin',
  '← Back to tables':'← Kthehu te tavolinat', 'WORKSPACE':'HAPËSIRA E PUNËS', 'Overview':'Përmbledhje', 'ARRA POS / ADMINISTRATION':'ARRA POS / ADMINISTRIMI',
  'Choose an area to manage your restaurant or review its activity.':'Zgjidhni një fushë për të menaxhuar restorantin ose për të shqyrtuar aktivitetin e tij.',
  'Access depends on your signed-in account and selected identity. An area may be unavailable if you do not have permission.':'Qasja varet nga llogaria e hyrë dhe identiteti i zgjedhur. Një fushë mund të mos jetë e disponueshme nëse nuk keni leje.',
  'Open area →':'Hap fushën →'
};
export const shellText = (language, key) => language === 'sq' ? (sq[key] ?? key) : key;
