import { XMLParser } from 'fast-xml-parser';
import { XmlFieldMapping } from '../types';

export interface SupplierParsedItem {
  identifier: string;
  identifierField: 'sku' | 'ean';
  sku?: string;
  ean?: string;
  price: number;
  stock: number;
  name?: string;
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
      const sku = mapping.skuPath ? this.resolvePath(node, mapping.skuPath) : undefined;
      const ean = mapping.eanPath ? this.resolvePath(node, mapping.eanPath) : undefined;
      const rawPrice = mapping.pricePath ? this.resolvePath(node, mapping.pricePath) : undefined;
      const rawStock = mapping.stockPath ? this.resolvePath(node, mapping.stockPath) : undefined;
      const name = mapping.namePath ? this.resolvePath(node, mapping.namePath) : undefined;

      const price = rawPrice ? parseFloat(rawPrice.replace(',', '.')) : 0;
      const stock = rawStock ? parseInt(rawStock.replace(/\s+/g, ''), 10) : 0;

      const identifier = mapping.identifierField === 'sku' ? (sku || '') : (ean || '');

      if (!identifier) {
        continue; // Skip items missing designated identifier
      }

      items.push({
        identifier,
        identifierField: mapping.identifierField,
        sku: sku || undefined,
        ean: ean || undefined,
        price: isNaN(price) ? 0 : price,
        stock: isNaN(stock) ? 0 : stock,
        name: name || undefined
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
          if (v && typeof v === 'object' && !Array.isArray(v)) {
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
