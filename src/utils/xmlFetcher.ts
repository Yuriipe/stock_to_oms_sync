import axios, { AxiosRequestConfig } from 'axios';
import fs from 'fs';
import { resolveLocalFilePath } from './fileResolver';

export type BrowserFetchFunction = (url: string, headers?: Record<string, string>) => Promise<string>;

let globalBrowserFetcher: BrowserFetchFunction | null = null;

export function registerBrowserFetcher(fetcher: BrowserFetchFunction | null): void {
  globalBrowserFetcher = fetcher;
}

export function getBrowserFetcher(): BrowserFetchFunction | null {
  return globalBrowserFetcher;
}

export async function fetchXmlSource(options: {
  sourceType: 'url' | 'file';
  sourcePath: string;
  authHeader?: string;
  timeoutMs?: number;
  browserFetcher?: BrowserFetchFunction | null;
}): Promise<string> {
  const { sourceType, sourcePath, authHeader, timeoutMs = 60000 } = options;

  if (sourceType === 'file') {
    const resolvedPath = resolveLocalFilePath(sourcePath);
    if (!resolvedPath) {
      throw new Error(`Local file not found: ${sourcePath}`);
    }
    return fs.readFileSync(resolvedPath, 'utf-8');
  }

  // URL Source
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pl,en;q=0.9,en-US;q=0.8'
  };

  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const effectiveFetcher = options.browserFetcher || globalBrowserFetcher;

  try {
    const config: AxiosRequestConfig = {
      headers,
      timeout: timeoutMs,
      responseType: 'text',
      maxRedirects: 5
    };
    const response = await axios.get(sourcePath, config);
    return response.data;
  } catch (err: unknown) {
    const status = (axios.isAxiosError(err) && err.response?.status) || 0;
    
    // If standard Axios gets 403 (or 503 / Akamai / Cloudflare challenge) and browserFetcher is available, retry via Electron browser engine
    if ((status === 403 || status === 503 || status === 0) && effectiveFetcher) {
      try {
        return await effectiveFetcher(sourcePath, headers);
      } catch (browserErr: unknown) {
        throw new Error(
          `Błąd pobierania XML przez wbudowaną przeglądarkę: ${browserErr instanceof Error ? browserErr.message : String(browserErr)}`
        );
      }
    }

    if (status === 403) {
      throw new Error(
        `Błąd 403 Forbidden: Serwer dostawcy blokuje bezpośrednie zapytania (ochrona Akamai / Cloudflare). Zapisz plik na dysku i wybierz "Plik lokalny" lub skorzystaj z wbudowanej przeglądarki aplikacji.`
      );
    }

    throw err instanceof Error ? err : new Error(String(err));
  }
}
