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

export function useCreateLocations() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof api.createLocations>[0], 'householdId'>) =>
      api.createLocations({ householdId, ...input }),
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

/**
 * Debounced-by-keystroke product search for the manual-add typeahead.
 *
 * `enabled` on a 2-character minimum rather than a timer: TanStack already
 * dedupes and caches per query string, so typing "Meh" → "Mehl" costs one
 * request per distinct prefix and replays instantly on backspace.
 */
export function useProductSearch(query: string) {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['inventory', 'product-search', householdId, query.trim().toLowerCase()],
    queryFn: () => api.searchProducts(householdId, query),
    enabled: query.trim().length >= 2,
  });
}

export function useProduct(productId: string | null) {
  return useQuery({
    queryKey: ['inventory', 'product', productId],
    queryFn: () => api.fetchProduct(productId!),
    enabled: !!productId,
  });
}

export function useSetRestockThreshold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, threshold }: { productId: string; threshold: number | null }) =>
      api.setRestockThreshold(productId, threshold),
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

export function useSetQuantity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      quantity,
      opened,
      note,
    }: {
      itemId: string;
      quantity: number;
      /** Undefined leaves opened_at alone. */
      opened?: boolean;
      note?: string;
    }) => api.setQuantity(itemId, quantity, opened, note),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, patch }: { productId: string; patch: Parameters<typeof api.updateProduct>[1] }) =>
      api.updateProduct(productId, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useMoveItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      locationId,
      quantity,
    }: {
      itemId: string;
      locationId: string | null;
      /** Omitted moves the whole lot. */
      quantity?: number | null;
    }) => api.moveItem(itemId, locationId, quantity),
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

export function useUpdateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateLocation>[1] }) =>
      api.updateLocation(id, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useProductCategories() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['inventory', 'categories', householdId],
    queryFn: () => api.fetchProductCategories(householdId),
  });
}
