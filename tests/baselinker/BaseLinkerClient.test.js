"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const axios_1 = __importDefault(require("axios"));
const BaseLinkerClient_1 = require("../../src/baselinker/BaseLinkerClient");
vitest_1.vi.mock('axios');
const mockedAxios = vitest_1.vi.mocked(axios_1.default, true);
(0, vitest_1.describe)('BaseLinkerClient', () => {
    let client;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        client = new BaseLinkerClient_1.BaseLinkerClient('dummy-token');
    });
    (0, vitest_1.it)('should fetch inventories list', async () => {
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
        (0, vitest_1.expect)(inventories).toHaveLength(1);
        (0, vitest_1.expect)(inventories[0].inventory_id).toBe(1234);
        (0, vitest_1.expect)(inventories[0].name).toBe('Main Inventory');
    });
    (0, vitest_1.it)('should fetch warehouses and price groups dynamically', async () => {
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
        (0, vitest_1.expect)(warehouses).toHaveLength(1);
        (0, vitest_1.expect)(warehouses[0].warehouse_id).toBe('bl_101');
        (0, vitest_1.expect)(priceGroups).toHaveLength(1);
        (0, vitest_1.expect)(priceGroups[0].currency).toBe('PLN');
    });
    (0, vitest_1.it)('should throw descriptive error on API error response', async () => {
        mockedAxios.post.mockResolvedValueOnce({
            data: {
                status: 'ERROR',
                error_code: 'ERROR_BAD_TOKEN',
                error_message: 'Invalid token'
            }
        });
        await (0, vitest_1.expect)(client.getInventories()).rejects.toThrow('BaseLinker API Error [ERROR_BAD_TOKEN]: Invalid token');
    });
    (0, vitest_1.it)('should chunk price and stock updates in batches <= 1000 items', async () => {
        // Generate 1500 updates
        const updates = {};
        for (let i = 1; i <= 1500; i++) {
            updates[i] = 19.99;
        }
        mockedAxios.post
            .mockResolvedValueOnce({ data: { status: 'SUCCESS', counter: 1000 } })
            .mockResolvedValueOnce({ data: { status: 'SUCCESS', counter: 500 } });
        const totalUpdated = await client.updateInventoryProductsPrices(1234, updates, 201);
        (0, vitest_1.expect)(mockedAxios.post).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(totalUpdated).toBe(1500);
    });
});
