// 生成済みブリーフィングを登録デバイスへ push する（runBriefing の末尾 / apns:check から呼ぶ）。
import { deleteDevice, insertPushLog, listDevices, markBriefingPushed } from '../db/repo.js';
import { resolveApnsSettings, sendApnsAlerts, type ApnsResult } from './apns.js';
import type { BriefingRow } from '../types.js';

/** APNs の alert payload は全体で 4KB まで。超えたらシグナルのみに落とす。 */
export const APNS_MAX_PAYLOAD_BYTES = 4096;

export type BriefingForPush = Pick<
  BriefingRow,
  'id' | 'briefing_date' | 'title' | 'summary' | 'payload_json'
>;

/**
 * push payload を組み立てる。v1 はフル内容（briefing キー）を載せ、4KB 超過時は
 * シグナルのみ（briefingId / briefingDate）に落とす。どちらの場合もアプリは
 * GET /briefings/latest で本文を取得できる。
 */
export function buildBriefingPushPayload(briefing: BriefingForPush): {
  payload: Record<string, unknown>;
  trimmed: boolean;
} {
  const base = {
    aps: {
      alert: { title: briefing.title ?? '朝ブリーフィング', body: briefing.summary ?? '' },
      sound: 'default',
    },
    briefingId: briefing.id,
    briefingDate: briefing.briefing_date,
  };
  const full = { ...base, briefing: JSON.parse(briefing.payload_json) as unknown };
  if (Buffer.byteLength(JSON.stringify(full), 'utf8') <= APNS_MAX_PAYLOAD_BYTES) {
    return { payload: full, trimmed: false };
  }
  return { payload: base, trimmed: true };
}

export interface PushBriefingResult {
  /** false = APNs 未設定 or デバイス未登録で送信せず（messages 参照） */
  attempted: boolean;
  sent: number;
  failed: number;
  /** 表示用ログ（呼び出し側で console に流す） */
  messages: string[];
}

/** ブリーフィングを全登録デバイスへ push し、push_log と briefings.pushed_at を記録する。 */
export async function pushBriefingToDevices(briefing: BriefingForPush): Promise<PushBriefingResult> {
  const skipped = (msg: string): PushBriefingResult => ({
    attempted: false,
    sent: 0,
    failed: 0,
    messages: [msg],
  });

  let settings;
  try {
    settings = resolveApnsSettings();
  } catch (e) {
    return skipped(`APNs 未設定のため push をスキップ: ${(e as Error).message}`);
  }
  const devices = listDevices().filter((d) => d.platform === 'ios');
  if (devices.length === 0) {
    return skipped('登録デバイスがないため push をスキップ（iOS アプリから POST /devices で登録）');
  }

  const messages: string[] = [];
  const { payload, trimmed } = buildBriefingPushPayload(briefing);
  if (trimmed) {
    messages.push(
      'payload が 4KB を超えたためシグナルのみで送信（本文はアプリが GET /briefings/latest で取得）',
    );
  }

  let results: ApnsResult[];
  try {
    results = await sendApnsAlerts(
      settings,
      devices.map((d) => ({ deviceToken: d.token, payload })),
    );
  } catch (e) {
    const error = (e as Error).message;
    for (const d of devices) {
      insertPushLog({ briefingId: briefing.id, deviceId: d.id, status: 'failed', error });
    }
    return { attempted: true, sent: 0, failed: devices.length, messages: [...messages, `✗ ${error}`] };
  }

  let sent = 0;
  results.forEach((r, i) => {
    const device = devices[i]!;
    if (r.status === 200) {
      sent += 1;
      insertPushLog({ briefingId: briefing.id, deviceId: device.id, status: 'sent', apnsId: r.apnsId });
      messages.push(`✓ device#${device.id} へ送信 (apns-id: ${r.apnsId ?? '-'})`);
    } else if (r.gone) {
      // push_log は devices に ON DELETE CASCADE なので、削除するデバイスのログは残さない
      deleteDevice(device.id);
      messages.push(
        `✗ device#${device.id}: トークン失効 (HTTP ${r.status} ${r.reason ?? ''}) → devices から削除`,
      );
    } else {
      const hint =
        r.reason === 'BadDeviceToken'
          ? '（APNS_ENV=sandbox/production とアプリのビルド環境が不一致の可能性）'
          : '';
      insertPushLog({
        briefingId: briefing.id,
        deviceId: device.id,
        status: 'failed',
        apnsId: r.apnsId,
        error: `HTTP ${r.status}${r.reason ? ` ${r.reason}` : ''}`,
      });
      messages.push(`✗ device#${device.id}: HTTP ${r.status}${r.reason ? ` (${r.reason})` : ''}${hint}`);
    }
  });

  if (sent > 0) markBriefingPushed(briefing.id);
  return { attempted: true, sent, failed: results.length - sent, messages };
}
