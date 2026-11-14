import { translate } from '../shared/i18n.js';
export function LanguageSetting({ language, onChange, busy, feedback }) {
  const t = key => translate(language, key, { language: language === 'sq' ? 'Shqip' : 'English' });
  return <section className="floor-list">
    <h2>{t('language.title')}</h2><p>{t('language.description')}</p>
    <label className="floor-field"><span>{t('language.label')}</span>
      <select value={language} disabled={busy} onChange={e => onChange(e.target.value)}>
        <option value="en">English</option><option value="sq">Shqip</option>
      </select>
    </label>
    {busy && <p role="status">{t('language.loading')}</p>}
    {feedback && <p role={feedback === 'failed' ? 'alert' : 'status'}>{t('language.' + feedback)}</p>}
  </section>;
}

