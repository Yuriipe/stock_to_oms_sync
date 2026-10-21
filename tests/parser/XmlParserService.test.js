"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const XmlParserService_1 = require("../../src/parser/XmlParserService");
(0, vitest_1.describe)('XmlParserService with Dynamic Mapping', () => {
    const service = new XmlParserService_1.XmlParserService();
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
    (0, vitest_1.it)('should parse standard XML using mapped paths', async () => {
        const mapping = {
            itemTag: 'product',
            identifierField: 'sku',
            skuPath: 'sku',
            eanPath: 'barcode',
            pricePath: 'price_netto',
            stockPath: 'stock_qty',
            namePath: 'name'
        };
        const items = await service.parseXml(standardXml, mapping);
        (0, vitest_1.expect)(items).toHaveLength(2);
        (0, vitest_1.expect)(items[0]).toEqual({
            identifier: 'SKU-AAA-01',
            identifierField: 'sku',
            sku: 'SKU-AAA-01',
            ean: '5901234567890',
            price: 45.5,
            stock: 15,
            name: 'Toy Helicopter'
        });
        (0, vitest_1.expect)(items[1].stock).toBe(0);
        (0, vitest_1.expect)(items[1].price).toBe(99.0);
    });
    (0, vitest_1.it)('should parse XML with nested price tags or attribute values', async () => {
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
        const mapping = {
            itemTag: 'item',
            identifierField: 'sku',
            skuPath: '@_code',
            eanPath: 'ean',
            pricePath: 'pricing.retail',
            stockPath: 'inventory.available'
        };
        const items = await service.parseXml(nestedXml, mapping);
        (0, vitest_1.expect)(items).toHaveLength(1);
        (0, vitest_1.expect)(items[0].sku).toBe('PROD-99');
        (0, vitest_1.expect)(items[0].price).toBe(129.99);
        (0, vitest_1.expect)(items[0].stock).toBe(8);
    });
    (0, vitest_1.it)('should inspect sample XML and discover candidate tags for UI mapping', () => {
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
        (0, vitest_1.expect)(candidates.detectedItemTags).toContain('item');
        (0, vitest_1.expect)(candidates.sampleProperties).toContain('sku');
        (0, vitest_1.expect)(candidates.sampleProperties).toContain('price');
    });
});
