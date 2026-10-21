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

  private async request<T = unknown>(method: string, parameters: Record<string, unknown> = {}): Promise<T> {
    const formData = new URLSearchParams();
    formData.append('token', this.token);
    formData.append('method', method);
    formData.append('parameters', JSON.stringify(parameters));

    const response = await axios.post(this.apiUrl, formData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
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

  public async updateInventoryProductsPrices(
    inventoryId: number,
    productsPrices: Record<string | number, number>,
    priceGroupId?: number
  ): Promise<number> {
    const entries = Object.entries(productsPrices);
    let totalUpdated = 0;
    const CHUNK_SIZE = 1000;

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const chunkRecord: Record<string, number> = {};
      for (const [key, val] of chunk) {
        chunkRecord[key] = val;
      }

      const params: Record<string, unknown> = {
        inventory_id: inventoryId,
        products: chunkRecord
      };
      if (priceGroupId !== undefined) {
        params.price_group_id = priceGroupId;
      }

      const res = await this.request<{ counter?: number }>('updateInventoryProductsPrices', params);
      totalUpdated += res.counter || chunk.length;
    }

    return totalUpdated;
  }

  public async updateInventoryProductsStock(
    inventoryId: number,
    productsStock: Record<string | number, number>,
    warehouseId?: string
  ): Promise<number> {
    const entries = Object.entries(productsStock);
    let totalUpdated = 0;
    const CHUNK_SIZE = 1000;

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const chunkRecord: Record<string, number> = {};
      for (const [key, val] of chunk) {
        chunkRecord[key] = val;
      }

      const params: Record<string, unknown> = {
        inventory_id: inventoryId,
        products: chunkRecord
      };
      if (warehouseId !== undefined) {
        params.warehouse_id = warehouseId;
      }

      const res = await this.request<{ counter?: number }>('updateInventoryProductsStock', params);
      totalUpdated += res.counter || chunk.length;
    }

    return totalUpdated;
  }
}
