import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { BaseLinkerClient } from '../../src/baselinker/BaseLinkerClient';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('BaseLinkerClient', () => {
  let client: BaseLinkerClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new BaseLinkerClient('dummy-token');
  });

  it('should fetch inventories list', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        status: 'SUCCESS',
        inventories: [
          {
            inventory_id: 1234,
            name: 'Main Inventory',
            default_warehouse: 'bl_1',
            default_price_group: 1
          }
        ]
      }
    });

    const inventories = await client.getInventories();
    expect(inventories).toHaveLength(1);
    expect(inventories[0].inventory_id).toBe(1234);
    expect(inventories[0].name).toBe('Main Inventory');
  });

  it('should fetch warehouses and price groups dynamically', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          status: 'SUCCESS',
          warehouses: [
            {
              warehouse_id: 'bl_101',
              name: 'Główny Magazyn',
              is_default: true
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          status: 'SUCCESS',
          price_groups: [
            {
              price_group_id: 201,
              name: 'Hurtowa',
              currency: 'PLN',
              is_default: true
            }
          ]
        }
      });

    const warehouses = await client.getInventoryWarehouses();
    const priceGroups = await client.getInventoryPriceGroups();

    expect(warehouses).toHaveLength(1);
    expect(warehouses[0].warehouse_id).toBe('bl_101');
    expect(priceGroups).toHaveLength(1);
    expect(priceGroups[0].currency).toBe('PLN');
  });

  it('should throw descriptive error on API error response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        status: 'ERROR',
        error_code: 'ERROR_BAD_TOKEN',
        error_message: 'Invalid token'
      }
    });

    await expect(client.getInventories()).rejects.toThrow('BaseLinker API Error [ERROR_BAD_TOKEN]: Invalid token');
  });

  it('should chunk price and stock updates in batches <= 1000 items', async () => {
    // Generate 1500 updates
    const updates: Record<number, number> = {};
    for (let i = 1; i <= 1500; i++) {
      updates[i] = 19.99;
    }

    mockedAxios.post
      .mockResolvedValueOnce({ data: { status: 'SUCCESS', counter: 1000 } })
      .mockResolvedValueOnce({ data: { status: 'SUCCESS', counter: 500 } });

    const totalUpdated = await client.updateInventoryProductsPrices(1234, updates, 201);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(totalUpdated).toBe(1500);
  });
});
