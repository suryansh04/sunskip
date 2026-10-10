import { ArrowUp, FlagCheckered, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";

// The ink card at the top of navigation: what to do now and what comes next.
// With onToggleVoice it also carries the speaker button for the spoken directions.
export default function InstructionBanner({ instruction, arrived, voiceOn = false, onToggleVoice = null }) {
  const Icon = arrived ? FlagCheckered : ArrowUp;
  return (
    <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-3.5 rounded-[18px] bg-ink px-4 py-3.5 text-white shadow-[0_6px_20px_rgba(20,12,4,.28)]">
      <Icon size={38} weight="bold" className="flex-none" aria-hidden />
      <div className="min-w-0 flex-1">
        <b className="block text-[21px] leading-[1.15] font-bold text-balance">{arrived ? "You have arrived" : `${instruction.title} · ${instruction.meters} m`}</b>
        <span className="text-[15px] text-[#D9CFC5]">{arrived ? "This walk is done" : instruction.then === "arrive" ? "then you arrive" : `then ${instruction.then}`}</span>
      </div>
      {onToggleVoice && (
        <button
          type="button"
          aria-label={voiceOn ? "Mute spoken directions" : "Turn on spoken directions"}
          onClick={onToggleVoice}
          className="press ml-auto grid size-11 flex-none place-items-center rounded-xl bg-white/[.12]"
        >
          {voiceOn ? <SpeakerHigh size={22} weight="fill" /> : <SpeakerSlash size={22} weight="bold" />}
        </button>
      )}
    </div>
  );
}
