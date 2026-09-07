import { useEffect, useState } from "react";
import LiveAudioVisualizer from "./LiveAudioVisualizer";
import { MAX_RECORDING_MS } from "./usePushToTalk";

export default function RecordingMeter({
  breadcrumbs,
  mediaRecorder,
}: {
  breadcrumbs: string[];
  mediaRecorder: MediaRecorder | null;
}) {
  const [remainingMs, setRemainingMs] = useState(MAX_RECORDING_MS);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = (): void => {
      setRemainingMs(
        Math.max(0, MAX_RECORDING_MS - (Date.now() - startedAt)),
      );
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="recording-meter" aria-hidden="true">
      <div className="recording-meter-breadcrumbs">
        {breadcrumbs.map((breadcrumb, index) => (
          <span key={`${breadcrumb}-${index}`}>
            {index > 0 ? (
              <span className="recording-meter-separator">/</span>
            ) : null}
            <span
              className={
                index === breadcrumbs.length - 1
                  ? "recording-meter-crumb recording-meter-crumb--active"
                  : "recording-meter-crumb"
              }
            >
              {breadcrumb}
            </span>
          </span>
        ))}
      </div>
      <div className="recording-meter-row">
        <div className="recording-meter-status">
          <span className="recording-meter-dot" />
          <span className="recording-meter-time">
            {Math.ceil(remainingMs / 1000)}s
          </span>
        </div>
        <div className="recording-meter-tape">
          {mediaRecorder ? (
            <LiveAudioVisualizer
              mediaRecorder={mediaRecorder}
              width={260}
              height={24}
              barWidth={2}
              gap={2}
              barColor="#ffffff"
              backgroundColor="transparent"
              fftSize={128}
              smoothingTimeConstant={0.5}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
