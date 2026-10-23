import axios from 'axios';

export interface NbpRate {
  code: string;
  currency: string;
  mid: number;
}

export class NbpRateService {
  private static cachedRates: Map<string, number> = new Map();
  private static lastFetchTime: number = 0;
  private static CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Returns exchange rate (mid rate to PLN) for a given currency code.
   * PLN returns 1.0.
   */
  public static async getRate(currencyCode: string): Promise<number> {
    const code = currencyCode.toUpperCase().trim();
    if (code === 'PLN') return 1.0;

    const now = Date.now();
    if (this.cachedRates.size === 0 || now - this.lastFetchTime > this.CACHE_TTL_MS) {
      await this.refreshRates();
    }

    const rate = this.cachedRates.get(code);
    if (!rate) {
      // Try one more refresh if not found
      await this.refreshRates();
      const freshRate = this.cachedRates.get(code);
      if (!freshRate) {
        throw new Error(`Nie znaleziono kursu NBP dla waluty: ${code}`);
      }
      return freshRate;
    }

    return rate;
  }

  /**
   * Refreshes rates from NBP Table A and Table B.
   */
  public static async refreshRates(): Promise<Map<string, number>> {
    try {
      const urls = [
        'https://api.nbp.pl/api/exchangerates/tables/A/?format=json',
        'https://api.nbp.pl/api/exchangerates/tables/B/?format=json'
      ];

      for (const url of urls) {
        try {
          const res = await axios.get<Array<{ rates: Array<{ code: string; mid: number }> }>>(url, {
            timeout: 10000,
            headers: { Accept: 'application/json' }
          });
          if (Array.isArray(res.data) && res.data[0]?.rates) {
            for (const r of res.data[0].rates) {
              if (r.code && typeof r.mid === 'number') {
                this.cachedRates.set(r.code.toUpperCase(), r.mid);
              }
            }
          }
        } catch (err) {
          console.warn(`[NbpRateService] Failed to fetch table from ${url}:`, err);
        }
      }

      this.cachedRates.set('PLN', 1.0);
      this.lastFetchTime = Date.now();
    } catch (e) {
      console.error('[NbpRateService] Error fetching exchange rates:', e);
      if (this.cachedRates.size === 0) {
        throw new Error(`Nie udało się pobrać kursów walut NBP: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return this.cachedRates;
  }

  /**
   * Helper to return all available currency codes with description
   */
  public static async getAllRates(): Promise<Array<{ code: string; rate: number }>> {
    const now = Date.now();
    if (this.cachedRates.size === 0 || now - this.lastFetchTime > this.CACHE_TTL_MS) {
      await this.refreshRates();
    }
    const list: Array<{ code: string; rate: number }> = [];
    for (const [code, rate] of this.cachedRates.entries()) {
      list.push({ code, rate });
    }
    return list.sort((a, b) => a.code.localeCompare(b.code));
  }

  public static clearCache(): void {
    this.cachedRates.clear();
    this.lastFetchTime = 0;
  }
}
