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

  it('should parse product images using imagePath or auto-detect image URL', async () => {
    const xml = `
      <catalogue>
        <item>
          <sku>IMG-01</sku>
          <price>49.90</price>
          <qty>12</qty>
          <images>
            <image>https://example.com/photos/item1.jpg</image>
            <image>https://example.com/photos/item1_side.jpg</image>
          </images>
        </item>
      </catalogue>
    `;

    const items = await service.parseXml(xml, {
      itemTag: 'item',
      identifierField: 'sku',
      skuPath: 'sku',
      eanPath: '',
      pricePath: 'price',
      stockPath: 'qty',
      imagePath: 'images.image'
    });

    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe('IMG-01');
    expect(items[0].imageUrl).toBe('https://example.com/photos/item1.jpg');
  });

  describe('Availability tag mapping and stock adjustment', () => {
    it('should set stock to 0 when availability is false, 0, brak or niedostępny', async () => {
      const xml = `
        <feed>
          <product>
            <sku>P-FALSE</sku>
            <price>29.99</price>
            <stock>15</stock>
            <availability>false</availability>
          </product>
          <product>
            <sku>P-ZERO</sku>
            <price>39.99</price>
            <stock>20</stock>
            <availability>0</availability>
          </product>
          <product>
            <sku>P-BRAK</sku>
            <price>19.99</price>
            <stock>8</stock>
            <availability>brak</availability>
          </product>
          <product>
            <sku>P-NIEDOSTEPNY</sku>
            <price>49.99</price>
            <stock>12</stock>
            <availability>niedostępny</availability>
          </product>
          <product>
            <sku>P-OUT-OF-STOCK</sku>
            <price>59.99</price>
            <stock>5</stock>
            <availability>out of stock</availability>
          </product>
          <product>
            <sku>P-AVAILABLE</sku>
            <price>99.99</price>
            <stock>30</stock>
            <availability>true</availability>
          </product>
          <product>
            <sku>P-DOSTEPNY</sku>
            <price>79.99</price>
            <stock>25</stock>
            <availability>dostępny</availability>
          </product>
        </feed>
      `;

      const mapping: XmlFieldMapping = {
        itemTag: 'product',
        identifierField: 'sku',
        skuPath: 'sku',
        eanPath: '',
        pricePath: 'price',
        stockPath: 'stock',
        availabilityPath: 'availability'
      };

      const items = await service.parseXml(xml, mapping);
      expect(items).toHaveLength(7);

      expect(items[0].sku).toBe('P-FALSE');
      expect(items[0].stock).toBe(0);
      expect(items[0].isAvailable).toBe(false);

      expect(items[1].sku).toBe('P-ZERO');
      expect(items[1].stock).toBe(0);
      expect(items[1].isAvailable).toBe(false);

      expect(items[2].sku).toBe('P-BRAK');
      expect(items[2].stock).toBe(0);
      expect(items[2].isAvailable).toBe(false);

      expect(items[3].sku).toBe('P-NIEDOSTEPNY');
      expect(items[3].stock).toBe(0);
      expect(items[3].isAvailable).toBe(false);

      expect(items[4].sku).toBe('P-OUT-OF-STOCK');
      expect(items[4].stock).toBe(0);
      expect(items[4].isAvailable).toBe(false);

      expect(items[5].sku).toBe('P-AVAILABLE');
      expect(items[5].stock).toBe(30);
      expect(items[5].isAvailable).toBe(true);

      expect(items[6].sku).toBe('P-DOSTEPNY');
      expect(items[6].stock).toBe(25);
      expect(items[6].isAvailable).toBe(true);
    });

    it('should correctly evaluate various values in isUnavailableValue', () => {
      // Unavailable values
      expect(service.isUnavailableValue('false')).toBe(true);
      expect(service.isUnavailableValue('FALSE')).toBe(true);
      expect(service.isUnavailableValue(false)).toBe(true);
      expect(service.isUnavailableValue('0')).toBe(true);
      expect(service.isUnavailableValue(0)).toBe(true);
      expect(service.isUnavailableValue('0.0')).toBe(true);
      expect(service.isUnavailableValue('-1')).toBe(true);
      expect(service.isUnavailableValue(-1)).toBe(true);
      expect(service.isUnavailableValue('no')).toBe(true);
      expect(service.isUnavailableValue('nie')).toBe(true);
      expect(service.isUnavailableValue('brak')).toBe(true);
      expect(service.isUnavailableValue('brak towaru')).toBe(true);
      expect(service.isUnavailableValue('brak w magazynie')).toBe(true);
      expect(service.isUnavailableValue('niedostępny')).toBe(true);
      expect(service.isUnavailableValue('niedostepny')).toBe(true);
      expect(service.isUnavailableValue('niedostępne')).toBe(true);
      expect(service.isUnavailableValue('wyprzedane')).toBe(true);
      expect(service.isUnavailableValue('out of stock')).toBe(true);
      expect(service.isUnavailableValue('unavailable')).toBe(true);
      expect(service.isUnavailableValue('0 szt')).toBe(true);
      expect(service.isUnavailableValue('0 pcs')).toBe(true);
      expect(service.isUnavailableValue('')).toBe(true);

      // Available values
      expect(service.isUnavailableValue('true')).toBe(false);
      expect(service.isUnavailableValue(true)).toBe(false);
      expect(service.isUnavailableValue('1')).toBe(false);
      expect(service.isUnavailableValue(1)).toBe(false);
      expect(service.isUnavailableValue('tak')).toBe(false);
      expect(service.isUnavailableValue('yes')).toBe(false);
      expect(service.isUnavailableValue('dostępny')).toBe(false);
      expect(service.isUnavailableValue('dostepny')).toBe(false);
      expect(service.isUnavailableValue('w magazynie')).toBe(false);
      expect(service.isUnavailableValue('in stock')).toBe(false);
      expect(service.isUnavailableValue('24h')).toBe(false);
      expect(service.isUnavailableValue('1-3 dni')).toBe(false);
      expect(service.isUnavailableValue(undefined)).toBe(false);
    });
  });
});
