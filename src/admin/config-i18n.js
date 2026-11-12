import sq from './config-sq.json';
export const configText = (language, text) => language === 'sq' ? (sq[text] ?? text) : text;

export const configError = (language, error, fallback) => configText(language, Object.hasOwn(sq, error) ? error : fallback);
