import { translate } from './i18n.js';

export function waiterTranslate(language, key, values = {}) {
  if (translate) {
    const result = translate(language, key, values);
    if (result !== key) return result;
  }
  return key.replace(/^waiter\./, '').replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
export function printDestination(language, destination) {
  const keys = { kitchen: 'Kitchen', bar: 'Bar', bill: 'Bill' };
  return Object.hasOwn(keys, destination) ? waiterTranslate(language, 'waiter.' + keys[destination]) : waiterTranslate(language, 'waiter.Unknown destination');
}
// Convert the design's CSS declarations to React's style object.
export function style(text) {
  const result = {};
  for (const declaration of (text || '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (name) result[name] = declaration.slice(colon + 1).trim();
  }
  return result;
}

