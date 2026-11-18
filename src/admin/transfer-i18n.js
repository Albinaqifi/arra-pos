const sq = {
  "Transfer manager": "Menaxheri i transferimeve",
  "Switch user": "Ndrysho perdoruesin",
  "RESTRICTED WORKSPACE": "HAPESIRE ME QASJE TE KUFIZUAR",
  "Correct eligible cash payments from Account B to Account A.": "Korrigjoni pagesat e lejuara me para ne dore nga llogaria B ne llogarine A.",
  "Open business day only": "Vetem dita e hapur e punes",
  "Only uncorrected cash payments in an open business day are eligible. Once the day is closed, its payments cannot be corrected here.": "Lejohen vetem pagesat e pakorrigjuara me para ne dore gjate dites se hapur te punes. Pas mbylljes se dites, pagesat e saj nuk mund te korrigjohen ketu.",
  "Loading eligible payments…": "Duke ngarkuar pagesat e lejuara…",
  "Refresh eligible payments": "Perditeso pagesat e lejuara",
  "STEP 1": "HAPI 1", "STEP 2": "HAPI 2", "STEP 3": "HAPI 3",
  "Choose a table": "Zgjidhni nje tavoline",
  "Select a table to review its eligible payments.": "Zgjidhni nje tavoline per te shqyrtuar pagesat e lejuara.",
  "Table {id}": "Tavolina {id}", " · Inactive": " · Joaktive", "{count} eligible": "{count} te lejuara",
  "No tables available.": "Nuk ka tavolina te disponueshme.", "← All tables": "← Te gjitha tavolinat",
  "Table {id} · Eligible payments": "Tavolina {id} · Pagesat e lejuara",
  "Amounts are shown in minor units. Review a payment before confirming its correction.": "Shumat shfaqen ne njesite me te vogla monetare. Shqyrtoni pagesen para se te konfirmoni korrigjimin.",
  "Payment #{id}": "Pagesa #{id}", "{amount} minor units": "{amount} njesi me te vogla monetare",
  "Review correction": "Shqyrto korrigjimin", "No eligible payments for this table.": "Nuk ka pagesa te lejuara per kete tavoline.",
  "Confirm payment correction": "Konfirmo korrigjimin e pageses", "Correct payment #{id}?": "Te korrigjohet pagesa #{id}?",
  "Table {table} · {amount} minor units · cash. This records a correction from Account B to Account A.": "Tavolina {table} · {amount} njesi me te vogla monetare · para ne dore. Kjo regjistron korrigjimin nga llogaria B ne llogarine A.",
  "Reason (optional)": "Arsyeja (opsionale)", "Correcting…": "Duke korrigjuar…", "Confirm B to A": "Konfirmo nga B ne A", "Cancel": "Anulo",
  "Eligible payments are unavailable. Check your access and try again.": "Pagesat e lejuara nuk jane te disponueshme. Kontrolloni qasjen dhe provoni perseri.",
  "Eligible payments are unavailable. Check your connection and try again.": "Pagesat e lejuara nuk jane te disponueshme. Kontrolloni lidhjen dhe provoni perseri.",
  "Correction was not confirmed. Refresh the list and check the payment before trying again.": "Korrigjimi nuk u konfirmua. Perditesoni listen dhe kontrolloni pagesen para se te provoni perseri.",
  "Correction result is unavailable. Refresh the list and check the payment before trying again.": "Rezultati i korrigjimit nuk eshte i disponueshem. Perditesoni listen dhe kontrolloni pagesen para se te provoni perseri.",
  "Payment #{id} corrected from Account B to Account A.": "Pagesa #{id} u korrigjua nga llogaria B ne llogarine A."
};
export function transferText(language, key, values = {}) {
  const text = language === 'sq' ? (sq[key] ?? key) : key;
  return text.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
