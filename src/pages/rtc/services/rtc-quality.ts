export interface RtcQualitySample {
  rtt: number;
  loss: number;
  jitter: number;
  availableBitrate?: number;
}

export const RTC_VIDEO_LEVELS = [
  { maxBitrate: 120_000, maxFramerate: 10, scaleResolutionDownBy: 4 },
  { maxBitrate: 350_000, maxFramerate: 15, scaleResolutionDownBy: 2 },
  { maxBitrate: 900_000, maxFramerate: 24, scaleResolutionDownBy: 1.5 },
  { maxBitrate: 1_800_000, maxFramerate: 30, scaleResolutionDownBy: 1 },
] as const;

export interface RtcQualityDecision {
  level: number;
  fallback: boolean;
}

/** 快降慢升并保留迟滞；缺少统计不是网络差，不能用累计丢包冒充当前窗口。 */
export const createRtcQualityPolicy = (): {
  sample: (value: RtcQualitySample, video: boolean) => RtcQualityDecision;
  level: () => number;
} => {
  let level = 2;
  let poor = 0;
  let good = 0;
  let severe = 0;
  return {
    level: (): number => level,
    sample: (value, video): RtcQualityDecision => {
      const lowBandwidth =
        video &&
        value.availableBitrate !== undefined &&
        value.availableBitrate < RTC_VIDEO_LEVELS[level]!.maxBitrate * 0.8;
      const bad =
        value.rtt > 0.5 ||
        value.loss > 0.05 ||
        value.jitter > 0.06 ||
        lowBandwidth;
      const unusable =
        value.rtt > 1.2 ||
        value.loss > 0.2 ||
        value.jitter > 0.15 ||
        (value.availableBitrate !== undefined &&
          value.availableBitrate < 80_000);
      poor = bad ? poor + 1 : 0;
      severe = unusable && (!video || level === 0) ? severe + 1 : 0;
      const healthy =
        value.rtt < 0.25 &&
        value.loss < 0.02 &&
        value.jitter < 0.03 &&
        (value.availableBitrate === undefined ||
          value.availableBitrate >
            RTC_VIDEO_LEVELS[Math.min(3, level + 1)]!.maxBitrate * 1.3);
      good = healthy ? good + 1 : 0;
      if (video && poor >= 2 && level > 0) {
        level -= 1;
        poor = 0;
        good = 0;
      } else if (video && good >= 10 && level < 3) {
        level += 1;
        good = 0;
      }
      return { level, fallback: severe >= 3 };
    },
  };
};

/** 从标准 getStats 中提取当前选中候选对与增量接收统计，不依赖 Chromium 私有字段。 */
export const createRtcStatsSampler = (): {
  read: (report: RTCStatsReport) => RtcQualitySample | null;
} => {
  const previous = new Map<string, { received: number; lost: number }>();
  return {
    read: (report): RtcQualitySample | null => {
      let pairId: string | undefined;
      let rtt = 0;
      let loss = 0;
      let jitter = 0;
      let availableBitrate: number | undefined;
      let measured = false;
      const seen = new Set<string>();
      report.forEach((raw: unknown): void => {
        const stat = raw as Record<string, unknown>;
        if (
          stat.type === 'transport' &&
          typeof stat.selectedCandidatePairId === 'string'
        )
          pairId = stat.selectedCandidatePairId;
      });
      report.forEach((raw: unknown): void => {
        const stat = raw as Record<string, unknown>;
        switch (stat.type) {
          case 'candidate-pair':
            if (stat.id !== pairId) break;
            if (typeof stat.currentRoundTripTime === 'number') {
              rtt = Math.max(rtt, stat.currentRoundTripTime);
              measured = true;
            }
            if (typeof stat.availableOutgoingBitrate === 'number')
              availableBitrate = stat.availableOutgoingBitrate;
            break;
          case 'remote-inbound-rtp':
            if (typeof stat.roundTripTime === 'number') {
              rtt = Math.max(rtt, stat.roundTripTime);
              measured = true;
            }
            if (typeof stat.fractionLost === 'number')
              loss = Math.max(loss, stat.fractionLost);
            break;
          case 'inbound-rtp': {
            if (typeof stat.jitter === 'number')
              jitter = Math.max(jitter, stat.jitter);
            if (
              typeof stat.id !== 'string' ||
              typeof stat.packetsReceived !== 'number' ||
              typeof stat.packetsLost !== 'number'
            )
              break;
            seen.add(stat.id);
            const old = previous.get(stat.id);
            const received = stat.packetsReceived;
            const lost = stat.packetsLost;
            previous.set(stat.id, { received, lost });
            if (!old || received < old.received) break;
            const receivedDelta = received - old.received;
            const lostDelta = Math.max(0, lost - old.lost);
            if (receivedDelta + lostDelta > 0) {
              loss = Math.max(loss, lostDelta / (receivedDelta + lostDelta));
              measured = true;
            }
            break;
          }
          default:
            break;
        }
      });
      for (const id of previous.keys()) if (!seen.has(id)) previous.delete(id);
      return measured ? { rtt, loss, jitter, availableBitrate } : null;
    },
  };
};
