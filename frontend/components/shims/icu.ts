/**
 *  - simple placeholders:      {name}
 *  - locale-aware plurals:     {name, plural, one {..} few {..} many {..} other {..}}
 *    (category picked via `Intl.PluralRules`, "#" renders the count value)
 */

function findClosingBrace(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return NaN;
}

export function pluralCategory(value: unknown, locale: string): string {
  const num = toNumber(value);
  if (Number.isNaN(num)) return "other";
  try {
    return new Intl.PluralRules(locale).select(num);
  } catch {
    try {
      return new Intl.PluralRules("en").select(num);
    } catch {
      return "other";
    }
  }
}

function formatCount(value: unknown, locale: string): string {
  const num = toNumber(value);
  if (Number.isNaN(num)) return String(value ?? "");
  try {
    return new Intl.NumberFormat(locale).format(num);
  } catch {
    return String(num);
  }
}

export function formatMessage(
  msg: string,
  values: Record<string, unknown>,
  locale: string,
): string {
  let out = "";
  let i = 0;
  while (i < msg.length) {
    const ch = msg[i];
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }

    const close = findClosingBrace(msg, i);
    if (close === -1) {
      out += ch;
      i++;
      continue;
    }

    const inner = msg.slice(i + 1, close);

    const pluralMatch = /^(\w+),\s*plural\s*,([\s\S]*)$/.exec(inner);
    if (pluralMatch) {
      const name = pluralMatch[1];
      const value = values[name];
      const category = pluralCategory(value, locale);

      const choices: Record<string, string> = {};
      const body = pluralMatch[2];
      let j = 0;
      while (j < body.length) {
        while (j < body.length && /\s/.test(body[j])) j++;
        if (j >= body.length) break;
        const sel = /^[^\s{}]+/.exec(body.slice(j));
        if (!sel) break;
        j += sel[0].length;
        while (j < body.length && /\s/.test(body[j])) j++;
        if (body[j] !== "{") break;
        const cClose = findClosingBrace(body, j);
        if (cClose === -1) break;
        choices[sel[0]] = body.slice(j + 1, cClose);
        j = cClose + 1;
      }

      const num = toNumber(value);
      const selected =
        choices[category] ??
        (Number.isNaN(num) ? undefined : choices[`=${num}`]) ??
        choices.other ??
        "";

      const formatted = formatMessage(selected, values, locale).replace(
        /#/g,
        () => formatCount(value, locale),
      );
      out += formatted;
      i = close + 1;
      continue;
    }

    const key = inner.trim();
    if (values[key] !== undefined && typeof values[key] !== "function") {
      out += String(values[key]);
    } else {
      out += msg.slice(i, close + 1);
    }
    i = close + 1;
  }
  return out;
}