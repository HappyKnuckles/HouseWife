/**
 * Getting a receipt photo off the phone.
 *
 * Shared by the new-expense form and the attachment gallery on an existing
 * expense, because the awkward half is identical either way: ask for the right
 * permission, say something useful when it is refused, and hand back nothing
 * at all when the user backs out. Where the picture then goes is the caller's
 * business — one uploads immediately, the other waits until the expense it
 * belongs to exists.
 */
import * as ImagePicker from 'expo-image-picker';

import { Alert } from '../../lib/alert';

export type ReceiptSource = 'camera' | 'library';

export interface PickedReceipt {
  uri: string;
  /** Passed through to storage so the object is not mislabelled as JPEG. */
  mimeType?: string;
  width?: number;
  height?: number;
}

/** Null when the user cancelled or refused permission — both are normal. */
export async function pickReceipt(from: ReceiptSource): Promise<PickedReceipt | null> {
  const permission =
    from === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    Alert.alert('Keine Berechtigung', 'Bitte erlaube den Zugriff in den Einstellungen.');
    return null;
  }

  // quality 0.6 rather than 1: a receipt is high-contrast text, which survives
  // the compression, and the upload happens on a phone in a shop.
  const result =
    from === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });

  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;

  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? undefined,
    width: asset.width,
    height: asset.height,
  };
}
