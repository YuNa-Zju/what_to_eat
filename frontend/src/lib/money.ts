export const MAX_COST_CENTS = 99_999_999;

export function parseCost(input: string): number | null {
  const value = input.normalize('NFKC').trim();
  if (!value) return null;
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) throw new Error('花费请填写非负金额，最多两位小数');
  const [yuan, fraction = ''] = value.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_COST_CENTS)
    throw new Error('本次总花费最多填写 999999.99 元');
  return cents;
}

export function costInput(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

export function formatCost(cents: number): string {
  return `¥${costInput(cents)}`;
}
