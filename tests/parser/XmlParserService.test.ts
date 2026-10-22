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

  it('should automatically fall back to quantity when stockPath is stock but XML uses quantity', async () => {
    const xml = `
      <products>
        <product>
          <sku>ART-123</sku>
          <quantity>10</quantity>
          <price>0.00</price>
        </product>
      </products>
    `;
    const items = await service.parseXml(xml, {
      itemTag: 'product',
      identifierField: 'sku',
      skuPath: 'sku',
      eanPath: 'ean',
      pricePath: 'price',
      stockPath: 'stock'
    });
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe('ART-123');
    expect(items[0].stock).toBe(10);
  });

  it('should fall back to product_id when sku and ean are empty, and handle missing price', async () => {
    const xml = `
      <products>
        <product>
          <product_id>386333526</product_id>
          <name>Poduszka Masło Pluszowa</name>
          <sku></sku>
          <ean></ean>
          <quantity>0</quantity>
          <price>10.00</price>
        </product>
        <product>
          <product_id>999999</product_id>
          <name>Zero Price Product</name>
          <sku>ART-ZERO</sku>
          <quantity>5</quantity>
          <price></price>
        </product>
      </products>
    `;

    const items = await service.parseXml(xml, {
      itemTag: 'product',
      identifierField: 'sku',
      skuPath: 'sku',
      eanPath: 'ean',
      pricePath: 'price',
      stockPath: 'stock'
    });

    expect(items).toHaveLength(2);
    expect(items[0].identifier).toBe('386333526');
    expect(items[0].sku).toBe('386333526');
    expect(items[0].name).toBe('Poduszka Masło Pluszowa');
    expect(items[0].price).toBe(10);
    expect(items[0].stock).toBe(0);

    expect(items[1].identifier).toBe('ART-ZERO');
    expect(items[1].price).toBe(0);
    expect(items[1].stock).toBe(5);
  });
});
