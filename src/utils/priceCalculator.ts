import { NbpRateService } from '../service/NbpRateService';

export type PriceModifierOperator = '*' | '/' | '+' | '-';

export interface PriceModificationParams {
  sourcePrice: number;
  sourceCurrency?: string | null;
  targetCurrency?: string | null;
  operator?: PriceModifierOperator | string | null;
  value?: number | null;
}

/**
 * Calculates converted and adjusted price based on:
 * 1. Source and Target currencies (using NBP exchange rate table)
 * 2. Modifier operation: multiply (*), divide (/), add (+), subtract (-)
 */
export async function calculateModifiedPrice(params: PriceModificationParams): Promise<number> {
  const { sourcePrice } = params;
  if (typeof sourcePrice !== 'number' || isNaN(sourcePrice) || sourcePrice <= 0) {
    return 0;
  }

  const srcCurr = (params.sourceCurrency || 'PLN').toUpperCase().trim();
  const tgtCurr = (params.targetCurrency || 'PLN').toUpperCase().trim();

  let convertedPrice = sourcePrice;

  if (srcCurr !== tgtCurr) {
    let srcRateToPln = 1.0;
    let tgtRateToPln = 1.0;

    if (srcCurr !== 'PLN') {
      try {
        srcRateToPln = await NbpRateService.getRate(srcCurr);
      } catch (e) {
        console.warn(`[priceCalculator] Could not get NBP rate for source currency ${srcCurr}, using 1.0:`, e);
      }
    }

    if (tgtCurr !== 'PLN') {
      try {
        tgtRateToPln = await NbpRateService.getRate(tgtCurr);
      } catch (e) {
        console.warn(`[priceCalculator] Could not get NBP rate for target currency ${tgtCurr}, using 1.0:`, e);
      }
    }

    // Convert: sourcePrice in srcCurr -> in PLN -> in tgtCurr
    // e.g. 100 PLN to EUR: 100 * 1.0 / 4.30 = 23.26 EUR
    // e.g. 10 EUR to PLN: 10 * 4.30 / 1.0 = 43.00 PLN
    if (tgtRateToPln > 0) {
      convertedPrice = (sourcePrice * srcRateToPln) / tgtRateToPln;
    }
  }

  // Apply modifier
  let finalPrice = convertedPrice;
  const op = params.operator || '*';
  const val = typeof params.value === 'number' && !isNaN(params.value) ? params.value : 1.0;

  switch (op) {
    case '/':
      if (val > 0) {
        finalPrice = convertedPrice / val;
      }
      break;
    case '+':
      finalPrice = convertedPrice + val;
      break;
    case '-':
      finalPrice = Math.max(0, convertedPrice - val);
      break;
    case '*':
    default:
      if (val > 0) {
        finalPrice = convertedPrice * val;
      }
      break;
  }

  return Math.round(finalPrice * 100) / 100;
}
