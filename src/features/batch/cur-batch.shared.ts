import { getEnvVariable } from '../../shared/database';

export type CurBatchOptions = {
  projectId?: string;
};

export const AWS_REGION = getEnvVariable('AWS_REGION') || 'ap-northeast-1';

export type BillingFileGroupKey = string;

export function extractBillingPeriod(objectKey: string): string | null {
  const hivePartitionMatch = objectKey.match(/BILLING_PERIOD=(\d{4})-(\d{2})/);
  if (hivePartitionMatch) {
    const [, year, month] = hivePartitionMatch;
    return `${year}-${month}`;
  }

  return null;
}

export function extractBillingVersion(objectKey: string): string | null {
  const match = objectKey.match(/BILLING_PERIOD=\d{4}-\d{2}\/([^/]+)\//);
  if (match) {
    return match[1];
  }

  return null;
}

export function determineLatestVersionPerGroup<TItem>(
  items: TItem[],
  getGroupKey: (item: TItem) => BillingFileGroupKey,
  getVersionKey: (item: TItem) => string | null,
): Map<BillingFileGroupKey, string | null> {
  const groupHasVersioned = new Map<BillingFileGroupKey, boolean>();
  const groupVersions = new Map<BillingFileGroupKey, Set<string>>();

  for (const item of items) {
    const groupKey = getGroupKey(item);
    const versionKey = getVersionKey(item);

    if (versionKey) {
      groupHasVersioned.set(groupKey, true);
      let set = groupVersions.get(groupKey);
      if (!set) {
        set = new Set<string>();
        groupVersions.set(groupKey, set);
      }
      set.add(versionKey);
    } else if (!groupHasVersioned.has(groupKey)) {
      // まだversion付きが出ていないグループのみfalseで初期化
      groupHasVersioned.set(groupKey, false);
    }
  }

  const latestVersionByGroup = new Map<BillingFileGroupKey, string | null>();

  for (const [groupKey, hasVersioned] of groupHasVersioned.entries()) {
    if (hasVersioned) {
      const versions = Array.from(groupVersions.get(groupKey) ?? []);
      versions.sort();
      const latestVersion = versions[versions.length - 1] ?? null;
      latestVersionByGroup.set(groupKey, latestVersion);
    } else {
      // version の概念がないグループ（overwrite型など）は null として扱う
      latestVersionByGroup.set(groupKey, null);
    }
  }

  return latestVersionByGroup;
}
