export type SupportedLanguage = 'ja' | 'en';

export type CurrencyCode = 'USD' | 'JPY' | string;

export type CurrencyConversionContext = {
  displayCurrency: CurrencyCode;
  rate: number;
};

export function getCurrencyConversionContext(
  baseCurrency: CurrencyCode,
  lang: string | undefined
): CurrencyConversionContext {
  const normalizedLang = (lang || '').toLowerCase();

  // 日本語の場合のみ、USD -> JPY (rate=150) に変換
  if (normalizedLang.startsWith('ja') && baseCurrency === 'USD') {
    return {
      displayCurrency: 'JPY',
      rate: 150,
    };
  }

  // それ以外は変換せず、元の通貨のまま
  return {
    displayCurrency: baseCurrency,
    rate: 1,
  };
}

export function convertAmount(
  amount: number,
  baseCurrency: CurrencyCode,
  lang: string | undefined
): { value: number; currency: CurrencyCode } {
  const { displayCurrency, rate } = getCurrencyConversionContext(baseCurrency, lang);
  return {
    value: amount * rate,
    currency: displayCurrency,
  };
}
