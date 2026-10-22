// Decimal units match the Unraid interface: 1 GB = 10^9 bytes.
export function decimalGB(n: number, locale: string) {
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      n / 1e9,
    ) + " GB"
  );
}
export function decimalBytes(n: number, locale: string) {
  const unit = n >= 1e12 ? 4 : n >= 1e9 ? 3 : n >= 1e6 ? 2 : n >= 1e3 ? 1 : 0;
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      n / 1000 ** unit,
    ) +
    " " +
    ["B", "kB", "MB", "GB", "TB"][unit]
  );
}
