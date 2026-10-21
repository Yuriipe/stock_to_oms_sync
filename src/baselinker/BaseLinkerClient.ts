import axios from 'axios';

export interface BaseLinkerInventoryItem {
  inventory_id: number;
  name: string;
  default_warehouse?: string;
  default_price_group?: number;
}

export interface BaseLinkerWarehouseItem {
  warehouse_id: string;
  name: string;
  is_default?: boolean;
}

export interface BaseLinkerPriceGroupItem {
  price_group_id: number;
  name: string;
  currency: string;
  is_default?: boolean;
}

export interface BaseLinkerProductMappingItem {
  product_id: number;
  sku: string;
  ean: string;
}

export class BaseLinkerClient {
  private apiUrl = 'https://api.baselinker.com/connector.php';
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  // Rate limiting: keep well under 50 queries per minute (max 1 request every 1250ms = 48 req/min)
  private static lastRequestTimestamp = 0;
  private static minRequestIntervalMs = 1300; // ~46 requests/min max

  private async throttle(): Promise<void> {
    const now = Date.now();
    const timeSinceLast = now - BaseLinkerClient.lastRequestTimestamp;
    if (timeSinceLast < BaseLinkerClient.minRequestIntervalMs) {
      const waitTime = BaseLinkerClient.minRequestIntervalMs - timeSinceLast;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    BaseLinkerClient.lastRequestTimestamp = Date.now();
  }

  private async request<T = unknown>(method: string, parameters: Record<string, unknown> = {}): Promise<T> {
    await this.throttle();

    const formData = new URLSearchParams();
    formData.append('token', this.token);
    formData.append('method', method);
    formData.append('parameters', JSON.stringify(parameters));

    const response = await axios.post(this.apiUrl, formData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-BLToken': this.token
      }
    });

    const data = response.data;
    if (data.status === 'ERROR') {
      throw new Error(`BaseLinker API Error [${data.error_code}]: ${data.error_message}`);
    }

    return data as T;
  }

  public async getInventories(): Promise<BaseLinkerInventoryItem[]> {
    const res = await this.request<{ inventories: BaseLinkerInventoryItem[] }>('getInventories');
    return res.inventories || [];
  }

  public async getInventoryWarehouses(): Promise<BaseLinkerWarehouseItem[]> {
    const res = await this.request<{ warehouses: BaseLinkerWarehouseItem[] }>('getInventoryWarehouses');
    return res.warehouses || [];
  }

  public async getInventoryPriceGroups(): Promise<BaseLinkerPriceGroupItem[]> {
    const res = await this.request<{ price_groups: BaseLinkerPriceGroupItem[] }>('getInventoryPriceGroups');
    return res.price_groups || [];
  }

  public async getInventoryProductsList(
    inventoryId: number,
    page: number = 1
  ): Promise<{ products: Record<string, { id: number; sku: string; ean: string }> }> {
    const res = await this.request<{
      products: Record<string, { id: number; sku: string; ean: string }>;
    }>('getInventoryProductsList', {
      inventory_id: inventoryId,
      page
    });
    return res;
  }

  /**
   * Bulk update prices using the official BaseLinker schema:
   * products: { [productId]: { [priceGroupId]: price } }
   */
  public async updateInventoryProductsPrices(
    inventoryId: number,
    productsPrices: Record<string | number, number>,
    priceGroupId?: number
  ): Promise<number> {
    const entries = Object.entries(productsPrices);
    if (entries.length === 0) return 0;
    if (priceGroupId === undefined) {
      throw new Error('BaseLinker updateInventoryProductsPrices requires a valid price_group_id');
    }

    let totalUpdated = 0;
    const CHUNK_SIZE = 1000;

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const chunkProducts: Record<string, Record<string, number>> = {};

      for (const [productId, price] of chunk) {
        chunkProducts[productId] = {
          [String(priceGroupId)]: price
        };
      }

      const params = {
        inventory_id: inventoryId,
        products: chunkProducts
      };

      const res = await this.request<{ counter?: number; warnings?: Record<string, string> }>(
        'updateInventoryProductsPrices',
        params
      );
      totalUpdated += res.counter ?? chunk.length;
    }

    return totalUpdated;
  }

  /**
   * Bulk update stocks using the official BaseLinker schema:
   * products: { [productId]: { [warehouseId]: stock } }
   */
  public async updateInventoryProductsStock(
    inventoryId: number,
    productsStock: Record<string | number, number>,
    warehouseId?: string
  ): Promise<number> {
    const entries = Object.entries(productsStock);
    if (entries.length === 0) return 0;
    if (!warehouseId) {
      throw new Error('BaseLinker updateInventoryProductsStock requires a valid warehouse_id');
    }

    let totalUpdated = 0;
    const CHUNK_SIZE = 1000;

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const chunkProducts: Record<string, Record<string, number>> = {};

      for (const [productId, stock] of chunk) {
        chunkProducts[productId] = {
          [warehouseId]: stock
        };
      }

      const params = {
        inventory_id: inventoryId,
        products: chunkProducts
      };

      const res = await this.request<{ counter?: number; warnings?: Record<string, string> }>(
        'updateInventoryProductsStock',
        params
      );
      totalUpdated += res.counter ?? chunk.length;
    }

    return totalUpdated;
  }

  /**
   * Adds a new product to the BaseLinker inventory catalog if it doesn't exist
   */
  public async addInventoryProduct(params: {
    inventory_id: number;
    sku?: string;
    ean?: string;
    prices?: Record<number | string, number>;
    stock?: Record<string, number>;
    name?: string;
  }): Promise<number> {
    const reqParameters: Record<string, unknown> = {
      inventory_id: params.inventory_id,
      sku: params.sku || '',
      ean: params.ean || ''
    };

    if (params.prices && Object.keys(params.prices).length > 0) {
      reqParameters.prices = params.prices;
    }

    if (params.stock && Object.keys(params.stock).length > 0) {
      reqParameters.stock = params.stock;
    }

    if (params.name) {
      reqParameters.text_fields = {
        name: params.name
      };
    }

    const res = await this.request<{ status: string; product_id: number }>(
      'addInventoryProduct',
      reqParameters
    );

    return res.product_id;
  }
}
