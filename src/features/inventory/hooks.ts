import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { MovementReason } from '../../lib/database.types';
import { useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

export function useInventoryTotals() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['inventory', 'totals', householdId],
    queryFn: () => api.fetchInventoryTotals(householdId),
  });
}

export function useInventoryItems() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['inventory', 'items', householdId],
    queryFn: () => api.fetchItems(householdId),
  });
}

export function useItemsForProduct(productId: string | null) {
  return useQuery({
    queryKey: ['inventory', 'product-items', productId],
    queryFn: () => api.fetchItemsForProduct(productId!),
    enabled: !!productId,
  });
}

export function useLocations() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['inventory', 'locations', householdId],
    queryFn: () => api.fetchLocations(householdId),
  });
}

export function useCreateLocation() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof api.createLocation>[0], 'householdId'>) =>
      api.createLocation({ householdId, ...input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

/** Generates (or re-sends an existing) code and writes it onto the location. */
export function useAssignLocationBarcode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ locationId, existingCode }: { locationId: string; existingCode?: string | null }) =>
      api.assignLocationBarcode(locationId, existingCode),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useClearLocationBarcode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (locationId: string) => api.clearLocationBarcode(locationId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useDeleteLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (locationId: string) => api.deleteLocation(locationId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

/** Checks a scanned code against this household's location tags. */
export function useResolveLocationBarcode() {
  const householdId = useHouseholdId();
  return useMutation({
    mutationFn: (barcode: string) => api.findLocationByBarcode(householdId, barcode),
  });
}

/**
 * The scan pipeline: local catalog → external provider → manual entry.
 *
 * Returns everything the scan sheet needs to decide which of those three
 * states to render, rather than deciding here — the caller owns the UI.
 */
export function useBarcodeResolver() {
  const householdId = useHouseholdId();

  return useMutation({
    mutationFn: async (barcode: string) => {
      const known = await api.findProductByBarcode(householdId, barcode);
      if (known) return { kind: 'known' as const, product: known };

      try {
        const lookup = await api.lookupBarcode(barcode);
        if (lookup.found && lookup.product) {
          return { kind: 'external' as const, result: lookup.product, provider: lookup.provider };
        }
      } catch {
        // A provider outage must not block adding the item by hand.
      }

      return { kind: 'unknown' as const, barcode };
    },
  });
}

export function useScanIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.scanIn>[0]) => api.scanIn(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useAdjustQuantity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      delta,
      reason,
    }: {
      itemId: string;
      delta: number;
      reason?: MovementReason;
    }) => api.adjustQuantity(itemId, delta, reason),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useUpdateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: Parameters<typeof api.updateItem>[1] }) =>
      api.updateItem(itemId, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useDeleteItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.deleteItem(itemId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}
