import sq from './config-sq.json';
export const configText = (language, text) => language === 'sq' ? (sq[text] ?? text) : text;
