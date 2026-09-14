/** This workspace uses four SNS services. Instagram has two Postiz login routes. */
export const SNS_PLATFORMS = [
  { id: 'x', name: 'X', identifiers: ['x'], textOnly: true, note: '本文・画像の予約に対応' },
  { id: 'threads', name: 'Threads', identifiers: ['threads'], textOnly: true, note: '本文・画像の予約に対応' },
  { id: 'instagram', name: 'Instagram', identifiers: ['instagram', 'instagram-standalone'], textOnly: false, note: '画像・リールの予約に対応（実接続は要確認）' },
  { id: 'youtube', name: 'YouTube', identifiers: ['youtube'], textOnly: false, note: '動画・表紙・公開設定に対応（実接続は要確認）' },
] as const;
export const snsPlatform = (identifier: string) => SNS_PLATFORMS.find(platform => (platform.identifiers as readonly string[]).includes(identifier));
