const sq = {
  "Transfer manager": "Menaxheri i transferimeve",
  "Switch user": "Ndrysho përdoruesin",
  "RESTRICTED WORKSPACE": "HAPËSIRË ME QASJE TË KUFIZUAR",
  "Correct eligible cash payments from Account B to Account A.": "Korrigjoni pagesat e lejuara me para në dorë nga llogaria B në llogarinë A.",
  "Open business day only": "Vetëm dita e hapur e punës",
  "Only uncorrected cash payments in an open business day are eligible. Once the day is closed, its payments cannot be corrected here.": "Lejohen vetëm pagesat e pakorrigjuara me para në dorë gjatë ditës së hapur të punës. Pas mbylljes së ditës, pagesat e saj nuk mund të korrigjohen këtu.",
  "Loading eligible payments…": "Duke ngarkuar pagesat e lejuara…",
  "Refresh eligible payments": "Përditëso pagesat e lejuara",
  "STEP 1": "HAPI 1", "STEP 2": "HAPI 2", "STEP 3": "HAPI 3",
  "Choose a table": "Zgjidhni një tavolinë",
  "Select a table to review its eligible payments.": "Zgjidhni një tavolinë për të shqyrtuar pagesat e lejuara.",
  "Table {id}": "Tavolina {id}", " · Inactive": " · Joaktive", "{count} eligible": "{count} të lejuara",
  "No tables available.": "Nuk ka tavolina të disponueshme.", "← All tables": "← Të gjitha tavolinat",
  "Table {id} · Eligible payments": "Tavolina {id} · Pagesat e lejuara",
  "Amounts are shown in minor units. Review a payment before confirming its correction.": "Shumat shfaqen në njësitë më të vogla monetare. Shqyrtoni pagesën para se të konfirmoni korrigjimin.",
  "Payment #{id}": "Pagesa #{id}", "{amount} minor units": "{amount} njësi më të vogla monetare",
  "Review correction": "Shqyrto korrigjimin", "No eligible payments for this table.": "Nuk ka pagesa të lejuara për këtë tavolinë.",
  "Confirm payment correction": "Konfirmo korrigjimin e pagesës", "Correct payment #{id}?": "Të korrigjohet pagesa #{id}?",
  "Table {table} · {amount} minor units · cash. This records a correction from Account B to Account A.": "Tavolina {table} · {amount} njësi më të vogla monetare · para në dorë. Kjo regjistron korrigjimin nga llogaria B në llogarinë A.",
  "Reason (optional)": "Arsyeja (opsionale)", "Correcting…": "Duke korrigjuar…", "Confirm B to A": "Konfirmo nga B në A", "Cancel": "Anulo",
  "Eligible payments are unavailable. Check your access and try again.": "Pagesat e lejuara nuk janë të disponueshme. Kontrolloni qasjen dhe provoni përsëri.",
  "Eligible payments are unavailable. Check your connection and try again.": "Pagesat e lejuara nuk janë të disponueshme. Kontrolloni lidhjen dhe provoni përsëri.",
  "Correction was not confirmed. Refresh the list and check the payment before trying again.": "Korrigjimi nuk u konfirmua. Përditësoni listën dhe kontrolloni pagesën para se të provoni përsëri.",
  "Correction result is unavailable. Refresh the list and check the payment before trying again.": "Rezultati i korrigjimit nuk është i disponueshëm. Përditësoni listën dhe kontrolloni pagesën para se të provoni përsëri.",
  "Payment #{id} corrected from Account B to Account A.": "Pagesa #{id} u korrigjua nga llogaria B në llogarinë A."
};
export function transferText(language, key, values = {}) {
  const text = language === 'sq' ? (sq[key] ?? key) : key;
  return text.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
