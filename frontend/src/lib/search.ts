export function matchScore(label: string, query: string): number {
  const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
  const text = normalize(label);
  const needle = normalize(query);
  if (!needle) return 0;
  if (text === needle) return 0;
  if (text.startsWith(needle)) return 1;
  if (text.includes(needle)) return 2;
  let position = 0;
  for (const char of needle) {
    const next = text.indexOf(char, position);
    if (next === -1) return Infinity;
    position = next + char.length;
  }
  return 3;
}

export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || year > 9999) return null;
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}
export function dayValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
