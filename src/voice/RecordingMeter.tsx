import {
  MAX_RECORDING_MS,
  RECORDING_SLOT_COUNT,
  type RecordingMeterState,
} from "./usePushToTalk";

export default function RecordingMeter({
  elapsedMs,
  levels,
}: RecordingMeterState) {
  const filled = Math.min(
    RECORDING_SLOT_COUNT,
    Math.ceil((elapsedMs / MAX_RECORDING_MS) * RECORDING_SLOT_COUNT),
  );
  const remaining = RECORDING_SLOT_COUNT - filled;

  return (
    <div className="recording-meter" aria-hidden="true">
      <div className="recording-meter-status">
        <span className="recording-meter-dot" />
        <span className="recording-meter-time">
          {Math.floor(elapsedMs / 1000)}s
        </span>
      </div>
      <div className="recording-meter-tape">
        <div className="recording-meter-wave">
          {levels.slice(0, filled).map((level, index) => (
            <span
              key={index}
              className="recording-meter-bar"
              style={{ height: `${Math.max(4, Math.round(level * 18))}px` }}
            />
          ))}
        </div>
        <span className="recording-meter-playhead" />
        <div className="recording-meter-rest">
          {Array.from({ length: remaining }, (_, index) => (
            <span key={index} className="recording-meter-tick" />
          ))}
        </div>
      </div>
    </div>
  );
}
