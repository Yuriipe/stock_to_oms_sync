import { XMLParser } from 'fast-xml-parser';
import { XmlFieldMapping } from '../types';

export interface SupplierParsedItem {
  identifier: string;
  identifierField: 'sku' | 'ean';
  sku?: string;
  ean?: string;
  price: number;
  stock: number;
  availability?: string;
  isAvailable?: boolean;
  name?: string;
  imageUrl?: string;
}

export interface XmlStructureCandidates {
  detectedItemTags: string[];
  sampleProperties: string[];
}

export class XmlParserService {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      parseTagValue: false
    });
  }

  /**
   * Helper to resolve dot-notated paths such as "pricing.retail" or "@_code"
   */
  private resolvePath(obj: unknown, path: string): string | undefined {
    if (!obj || !path) return undefined;
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (current === undefined || current === null) return undefined;
    return String(current).trim();
  }

  /**
   * Resolves path returning the first string if target is an array or object
   */
  private resolvePathFirst(obj: unknown, path: string): string | undefined {
    if (!obj || !path) return undefined;
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      const record = current as Record<string, unknown>;
      current = record[part];
      if (Array.isArray(current) && current.length > 0) {
        current = current[0];
      }
    }

    if (current === undefined || current === null) return undefined;
    if (typeof current === 'object') {
      const vals = Object.values(current as Record<string, unknown>);
      if (vals.length > 0 && vals[0] !== undefined && vals[0] !== null) {
        return String(vals[0]).trim();
      }
      return undefined;
    }
    return String(current).trim();
  }

  /**
   * Determines if an availability tag value indicates false / out of stock / unavailable.
   */
  public isUnavailableValue(val: unknown): boolean {
    if (val === undefined || val === null) return false;
    if (typeof val === 'boolean') return !val;
    if (typeof val === 'number') return val <= 0;

    const s = String(val).trim().toLowerCase();
    if (s === '') return true;

    const unavailableExact = new Set([
      '0',
      '0.0',
      '0.00',
      '-1',
      'false',
      'f',
      'nie',
      'no',
      'off',
      'none',
      'null',
      'undefined',
      'brak',
      'brak towaru',
      'brak w magazynie',
      'brak na magazynie',
      'chwilowy brak',
      'wyprzedane',
      'wyprzedany',
      'wyprzedana',
      'niedostepny',
      'niedostępny',
      'niedostepne',
      'niedostępne',
      'niedostepna',
      'niedostępna',
      'niedostepnosc',
      'niedostępność',
      'nieaktywny',
      'nieaktywne',
      'nieaktywna',
      'out of stock',
      'out_of_stock',
      'outofstock',
      'unavailable',
      'not available',
      'not_available',
      'sold out',
      'sold_out',
      'soldout',
      'discontinued',
      'zapytaj o dostepnosc',
      'zapytaj o dostępność',
      'nicht lieferbar',
      'nicht verfügbar',
      'nicht verfugbar',
      'ausverkauft',
      'nein'
    ]);

    if (unavailableExact.has(s)) return true;

    if (
      s.startsWith('brak') ||
      s.startsWith('niedostępn') ||
      s.startsWith('niedostepn') ||
      s.startsWith('wyprzedan') ||
      s.startsWith('nieaktywn') ||
      s.startsWith('out of stock') ||
      s.startsWith('out_of_stock') ||
      s.startsWith('sold out') ||
      s.startsWith('sold_out') ||
      s.startsWith('unavail') ||
      s.startsWith('not avail') ||
      s.startsWith('nicht ') ||
      s.startsWith('ausverkauft')
    ) {
      return true;
    }

    if (/^[-+]?0+(?:\.0+)?(?:\s*(?:szt|sztuk|\.|pcs|item|items|op|opak))?$/.test(s) || /^-\d+(?:\.\d+)?$/.test(s)) {
      return true;
    }

    if (/^(?:stan|ilosc|ilość|qty|quantity|stock)\s*[:=]\s*0+$/i.test(s)) {
      return true;
    }

    return false;
  }

  /**
   * Recursively finds arrays or single objects matching the itemTag
   */
  private findItemNodes(root: unknown, itemTag: string): unknown[] {
    const results: unknown[] = [];

    const traverse = (node: unknown) => {
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        for (const child of node) traverse(child);
        return;
      }

      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === itemTag) {
          if (Array.isArray(value)) {
            results.push(...value);
          } else if (value && typeof value === 'object') {
            results.push(value);
          }
        } else if (value && typeof value === 'object') {
          traverse(value);
        }
      }
    };

    traverse(root);
    return results;
  }

  public parseXml(xmlContent: string, mapping: XmlFieldMapping): SupplierParsedItem[] {
    const parsedObj = this.parser.parse(xmlContent);
    const itemNodes = this.findItemNodes(parsedObj, mapping.itemTag);

    const items: SupplierParsedItem[] = [];

    for (const node of itemNodes) {
      let sku = mapping.skuPath ? this.resolvePath(node, mapping.skuPath) : undefined;
      if (!sku) {
        for (const candidate of [
          'sku',
          'kod',
          'symbol',
          'code',
          'product_id',
          'id',
          'item_id',
          'id_produktu',
          'kod_produktu',
          'numer'
        ]) {
          const val = this.resolvePath(node, candidate);
          if (val) {
            sku = val;
            break;
          }
        }
      }

      let ean = mapping.eanPath ? this.resolvePath(node, mapping.eanPath) : undefined;
      if (!ean) {
        for (const candidate of ['ean', 'barcode', 'kod_kreskowy', 'gtin', 'ean13']) {
          const val = this.resolvePath(node, candidate);
          if (val) {
            ean = val;
            break;
          }
        }
      }

      let rawPrice = mapping.pricePath ? this.resolvePath(node, mapping.pricePath) : undefined;
      if (rawPrice === undefined) {
        for (const candidate of ['price', 'cena', 'price_brutto', 'cena_brutto', 'gross_price', 'cena_netto', 'net_price']) {
          const val = this.resolvePath(node, candidate);
          if (val !== undefined) {
            rawPrice = val;
            break;
          }
        }
      }

      let rawStock = mapping.stockPath ? this.resolvePath(node, mapping.stockPath) : undefined;
      if (rawStock === undefined) {
        for (const candidate of ['quantity', 'qty', 'stock', 'stan', 'ilosc', 'count']) {
          const val = this.resolvePath(node, candidate);
          if (val !== undefined) {
            rawStock = val;
            break;
          }
        }
      }

      let rawAvailability = mapping.availabilityPath ? this.resolvePath(node, mapping.availabilityPath) : undefined;
      if (rawAvailability === undefined && !mapping.availabilityPath) {
        for (const candidate of [
          'availability',
          'available',
          'dostepnosc',
          'dostepny',
          'status',
          'in_stock',
          'is_available',
          '@_available',
          '@_status'
        ]) {
          const val = this.resolvePath(node, candidate);
          if (val !== undefined) {
            rawAvailability = val;
            break;
          }
        }
      }

      let name = mapping.namePath ? this.resolvePath(node, mapping.namePath) : undefined;
      if (!name) {
        for (const candidate of ['name', 'nazwa', 'title', 'tytul', 'product_name', 'nazwa_produktu']) {
          const val = this.resolvePath(node, candidate);
          if (val) {
            name = val;
            break;
          }
        }
      }

      const price = rawPrice ? (parseFloat(rawPrice.replace(',', '.')) || 0) : 0;
      let stock = rawStock ? (parseInt(rawStock.replace(/\s+/g, ''), 10) || 0) : 0;
      if (isNaN(stock) || stock < 0) stock = 0;

      let isAvailable: boolean | undefined = undefined;
      if (rawAvailability !== undefined) {
        const isUnavail = this.isUnavailableValue(rawAvailability);
        isAvailable = !isUnavail;
        if (isUnavail) {
          stock = 0;
        }
      }

      // Primary identifier according to identifierField, falling back gracefully
      let identifier = mapping.identifierField === 'sku' ? (sku || ean || '') : (ean || sku || '');
      if (!identifier) {
        for (const candidate of ['product_id', 'id', 'item_id', 'id_produktu']) {
          const val = this.resolvePath(node, candidate);
          if (val) {
            identifier = val;
            if (!sku) sku = val;
            break;
          }
        }
      }

      if (!identifier) {
        continue; // Skip items missing designated identifier
      }

      let imageUrl = mapping.imagePath ? this.resolvePathFirst(node, mapping.imagePath) : undefined;
      if (!imageUrl) {
        for (const candidate of [
          'image',
          'images',
          'zdjecie',
          'zdjecia',
          'photo',
          'photos',
          'image_url',
          'img',
          'imgs',
          'picture',
          'pictures',
          'main_image',
          'images.image',
          'images.url',
          'zdjecia.zdjecie'
        ]) {
          const val = this.resolvePathFirst(node, candidate);
          if (val && typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://') || val.includes('/'))) {
            imageUrl = val;
            break;
          }
        }
      }

      items.push({
        identifier,
        identifierField: mapping.identifierField,
        sku: sku || undefined,
        ean: ean || undefined,
        price: isNaN(price) ? 0 : price,
        stock: isNaN(stock) ? 0 : stock,
        availability: rawAvailability,
        isAvailable,
        name: name || undefined,
        imageUrl: imageUrl || undefined
      });
    }

    return items;
  }

  /**
   * Inspects XML sample to detect repeat item tags and sample fields for UI mapping
   */
  public inspectStructure(xmlContent: string): XmlStructureCandidates {
    const parsedObj = this.parser.parse(xmlContent);
    const tagCounts: Record<string, number> = {};
    const sampleNodes: Record<string, unknown> = {};

    const traverse = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const child of node) traverse(child);
        return;
      }

      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          tagCounts[key] = (tagCounts[key] || 0) + value.length;
          if (!sampleNodes[key] && value[0]) sampleNodes[key] = value[0];
          for (const item of value) {
            traverse(item);
          }
        } else if (value && typeof value === 'object') {
          tagCounts[key] = (tagCounts[key] || 0) + 1;
          if (!sampleNodes[key]) sampleNodes[key] = value;
          traverse(value);
        }
      }
    };

    traverse(parsedObj);

    // The root document tag usually has count 1 and holds everything; filter or prioritize child container tags
    const rootKeys = Object.keys(parsedObj);
    const detectedItemTags = Object.keys(tagCounts)
      .filter((k) => !rootKeys.includes(k) || tagCounts[k] > 1)
      .sort((a, b) => tagCounts[b] - tagCounts[a]);

    if (detectedItemTags.length === 0 && Object.keys(tagCounts).length > 0) {
      detectedItemTags.push(...Object.keys(tagCounts));
    }

    // Gather flat and nested keys from top detected node
    const topTag = detectedItemTags[0];
    const sampleProps: string[] = [];

    if (topTag && sampleNodes[topTag]) {
      const nodeToInspect = sampleNodes[topTag];
      const extractKeys = (curr: unknown, prefix = '') => {
        if (!curr || typeof curr !== 'object') return;
        for (const [k, v] of Object.entries(curr as Record<string, unknown>)) {
          const path = prefix ? `${prefix}.${k}` : k;
          sampleProps.push(path);
          if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
            extractKeys(v[0], path);
          } else if (v && typeof v === 'object' && !Array.isArray(v)) {
            extractKeys(v, path);
          }
        }
      };

      if (typeof nodeToInspect === 'object') {
        extractKeys(nodeToInspect);
      }
    }

    return {
      detectedItemTags,
      sampleProperties: Array.from(new Set(sampleProps))
    };
  }
}
