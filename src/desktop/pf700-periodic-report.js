function periodicReport(range, format, start, end) {
  if (!['date', 'record'].includes(range) || !['short', 'detailed'].includes(format) ||
      typeof start !== 'string' || typeof end !== 'string') return null;
  let first, last;
  if (range === 'date') {
    const parse = value => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) return null;
      const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      // PF700 two-digit years use the same 2000-based interpretation as the daily report.
      if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
      return { order: value, data: match[3] + match[2] + match[1].slice(2) };
    };
    first = parse(start); last = parse(end);
  } else {
    const parse = value => /^\d{1,4}$/.test(value) && Number(value) > 0
      ? { order: Number(value), data: value.padStart(4, '0') } : null;
    first = parse(start); last = parse(end);
  }
  if (!first || !last || first.order > last.order) return null;
  const command = range === 'date' ? (format === 'short' ? 79 : 94) : (format === 'short' ? 95 : 73);
  return {command, data: `${first.data},${last.data}`};
}
module.exports = { periodicReport };
