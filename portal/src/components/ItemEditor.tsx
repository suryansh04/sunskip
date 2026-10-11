import { Trash, Tree, Umbrella } from "@phosphor-icons/react";

// Slider ranges stay inside what POST /portal/simulate accepts (api.md 16)
const TREE_FIELDS = [
  { key: "heightM", label: "Height", min: 3, max: 15, step: 0.5, unit: " m" },
  { key: "crownRadiusM", label: "Crown radius", min: 1, max: 8, step: 0.5, unit: " m" },
];
const SHELTER_FIELDS = [
  { key: "widthM", label: "Width", min: 2, max: 8, step: 0.5, unit: " m" },
  { key: "lengthM", label: "Length", min: 3, max: 20, step: 0.5, unit: " m" },
  { key: "heightM", label: "Roof height", min: 2.5, max: 5, step: 0.5, unit: " m" },
  { key: "bearingDeg", label: "Turn", min: 0, max: 179, step: 1, unit: "°" },
];

// The selected tree or shelter: its size, and Remove
export default function ItemEditor({ item, onChange, onRemove }) {
  const isTree = item.type === "TREE";
  const Icon = isTree ? Tree : Umbrella;
  return (
    <div className="grid animate-enter gap-3 border-b border-line px-6.5 py-4">
      <h4 className="cond flex items-center gap-2 text-[20px]">
        <Icon size={20} weight="bold" />
        {isTree ? "Tree" : "Shelter"}
        <button type="button" onClick={onRemove} className="ml-auto flex items-center gap-1.5 text-[13.5px] font-bold tracking-normal text-severe normal-case [font-stretch:100%]">
          <Trash size={16} weight="bold" />
          Remove
        </button>
      </h4>
      {(isTree ? TREE_FIELDS : SHELTER_FIELDS).map((field) => (
        <label key={field.key} className="grid grid-cols-[104px_1fr_60px] items-center gap-3 text-[14px]">
          <span>{field.label}</span>
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={item[field.key]}
            onChange={(event) => onChange(field.key, Number(event.target.value))}
            className="accent-ink"
          />
          <output className="text-right font-[750] tabular-nums">
            {item[field.key]}
            {field.unit}
          </output>
        </label>
      ))}
    </div>
  );
}
