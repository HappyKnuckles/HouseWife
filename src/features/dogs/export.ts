import { Platform, Share } from 'react-native';

import type { DogCommandRow } from '../../lib/database.types';
import { formatDate } from '../../lib/format';

/**
 * The commands as plain text.
 *
 * Plain text rather than CSV or JSON, because of who the export is for: the
 * dog-sitter, the Hundeschule, the parents who have the dog for a weekend.
 * They are going to read it in WhatsApp, not open it in a spreadsheet — so the
 * export is the thing they read, and it has to survive being pasted anywhere.
 *
 * Exported separately from the sharing so it stays trivially testable and so a
 * future "als Datei speichern" reuses exactly the same text.
 */
export function renderDogCommands(commands: DogCommandRow[]): string {
  const body = commands
    .map((entry, index) => {
      const heading = `${index + 1}. ${entry.command}`;
      const description = entry.description?.trim();
      // Indented continuation lines, so a multi-line description still reads as
      // belonging to its command after WhatsApp has re-wrapped it.
      return description
        ? `${heading}\n${description
            .split('\n')
            .map((line) => `   ${line.trim()}`)
            .join('\n')}`
        : heading;
    })
    .join('\n\n');

  const count = commands.length === 1 ? '1 Kommando' : `${commands.length} Kommandos`;

  return `Hundekommandos\n\n${body}\n\nStand: ${formatDate(new Date())} · ${count}`;
}

export type ExportResult = 'shared' | 'copied' | 'dismissed';

interface WebNavigator {
  share?: (data: { title?: string; text?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

/**
 * Hands the text to the OS share sheet.
 *
 * On web there is no share sheet worth the name: `navigator.share` exists on
 * mobile browsers and almost nowhere else, so the fallback is the clipboard —
 * which is what someone on a laptop was going to do with it anyway. A cancelled
 * share is a normal outcome, not an error, and comes back as 'dismissed'.
 */
export async function exportDogCommands(commands: DogCommandRow[]): Promise<ExportResult> {
  const text = renderDogCommands(commands);

  if (Platform.OS === 'web') {
    const nav = (globalThis as { navigator?: WebNavigator }).navigator;

    if (nav?.share) {
      try {
        await nav.share({ title: 'Hundekommandos', text });
        return 'shared';
      } catch {
        // Either the user dismissed it or the browser refused; the clipboard
        // below still gets them the text.
      }
    }

    if (nav?.clipboard) {
      await nav.clipboard.writeText(text);
      return 'copied';
    }

    return 'dismissed';
  }

  const result = await Share.share({ title: 'Hundekommandos', message: text });
  return result.action === Share.sharedAction ? 'shared' : 'dismissed';
}
