import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { DailyRecord, DigiSession, ExportInterval, Site } from './types';

/**
 * Build a CSV string from an array of DailyRecords.
 * Format: date,stage_height_ft  or  date,stage_height_m
 */
export function buildCsv(
  records: DailyRecord[],
  site: Site,
  session: DigiSession,
  interval: ExportInterval = 'day',
): string {
  const unit = records[0]?.unit ?? 'ft';
  const timeColumn = interval === 'day' ? 'date' : 'datetime';
  const header = `# H2oDigiGraph Export\n# Site: ${site.name} (${site.siteCode})\n# Captured: ${session.capturedAt}\n# Exported: ${new Date().toISOString()}\n# Interval: ${interval === 'day' ? 'Daily' : '4-hour'}\n${timeColumn},stage_height_${unit}`;
  const rows = records.map((r) => `${r.date},${r.stageHeight}`);
  return [header, ...rows].join('\n');
}

/**
 * Write the CSV to a temporary file and share it via the OS share sheet.
 * On web this triggers a browser download.
 */
export async function exportCsv(
  records: DailyRecord[],
  site: Site,
  session: DigiSession,
  interval: ExportInterval = 'day',
): Promise<string> {
  const csv = buildCsv(records, site, session, interval);
  const intervalSuffix = interval === 'day' ? 'daily' : '4h';
  const filename = `${site.siteCode}_${session.capturedAt.slice(0, 10)}_stage_${intervalSuffix}.csv`;

  if (typeof document !== 'undefined') {
    // Web: trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return filename;
  }

  // Native: write to cache and share
  const uri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export Stage Data' });
  return uri;
}
