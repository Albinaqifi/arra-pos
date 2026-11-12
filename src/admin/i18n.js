import en from './en.json';
import sq from './sq.json';

const dictionaries = { en, sq };
export function translate(language, key, values = {}) {
  const template = dictionaries[language]?.[key] ?? en[key] ?? key;
  return template.replace(/\{([\w]+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
