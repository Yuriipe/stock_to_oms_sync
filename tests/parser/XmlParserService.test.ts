import { describe, it, expect } from 'vitest';
import { XmlParserService, SupplierParsedItem } from '../../src/parser/XmlParserService';
import { XmlFieldMapping } from '../../src/types';

describe('XmlParserService with Dynamic Mapping', () => {
  const service = new XmlParserService();

  const standardXml = `<?xml version="1.0" encoding="UTF-8"?>
  <offer>
    <products>
      <product>
        <id>1001</id>
        <sku>SKU-AAA-01</sku>
        <barcode>5901234567890</barcode>
        <price_netto>45.50</price_netto>
        <stock_qty>15</stock_qty>
        <name>Toy Helicopter</name>
      </product>
      <product>
        <id>1002</id>
        <sku>SKU-BBB-02</sku>
        <barcode>5909876543210</barcode>
        <price_netto>99.00</price_netto>
        <stock_qty>0</stock_qty>
        <name>Racing Drone</name>
      </product>
    </products>
  </offer>`;

  it('should parse standard XML using mapped paths', async () => {
    const mapping: XmlFieldMapping = {
      itemTag: 'product',
      identifierField: 'sku',
      skuPath: 'sku',
      eanPath: 'barcode',
      pricePath: 'price_netto',
      stockPath: 'stock_qty',
      namePath: 'name'
    };

    const items: SupplierParsedItem[] = await service.parseXml(standardXml, mapping);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      identifier: 'SKU-AAA-01',
      identifierField: 'sku',
      sku: 'SKU-AAA-01',
      ean: '5901234567890',
      price: 45.5,
      stock: 15,
      name: 'Toy Helicopter'
    });
    expect(items[1].stock).toBe(0);
    expect(items[1].price).toBe(99.0);
  });

  it('should parse XML with nested price tags or attribute values', async () => {
    const nestedXml = `
      <catalogue>
        <item code="PROD-99">
          <ean>1122334455</ean>
          <pricing>
            <retail>129.99</retail>
          </pricing>
          <inventory>
            <available>8</available>
          </inventory>
        </item>
      </catalogue>
    `;

    const mapping: XmlFieldMapping = {
      itemTag: 'item',
      identifierField: 'sku',
      skuPath: '@_code',
      eanPath: 'ean',
      pricePath: 'pricing.retail',
      stockPath: 'inventory.available'
    };

    const items = await service.parseXml(nestedXml, mapping);
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe('PROD-99');
    expect(items[0].price).toBe(129.99);
    expect(items[0].stock).toBe(8);
  });

  it('should inspect sample XML and discover candidate tags for UI mapping', () => {
    const sampleXml = `
      <shop>
        <item>
          <id>10</id>
          <sku>TEST-1</sku>
          <price>19.50</price>
        </item>
      </shop>
    `;

    const candidates = service.inspectStructure(sampleXml);
    expect(candidates.detectedItemTags).toContain('item');
    expect(candidates.sampleProperties).toContain('sku');
    expect(candidates.sampleProperties).toContain('price');
  });
});
