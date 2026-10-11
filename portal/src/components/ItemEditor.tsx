import { Trash, Tree, Umbrella } from "@phosphor-icons/react";
import { SHELTERS, TREES, YOUNG_TREE, itemCost } from "../costs";
import { inr } from "../format";
import Dropdown from "./Dropdown";

// Slider ranges stay inside what POST /portal/simulate accepts (api.md 16)
const TREE_FIELDS = [
  { key: "heightM", label: "Height", min: 3, max: 30, step: 0.5, unit: " m" },
  { key: "crownRadiusM", label: "Crown radius", min: 1, max: 10, step: 0.5, unit: " m" },
];
const SHELTER_FIELDS = [
  { key: "widthM", label: "Width", min: 2, max: 8, step: 0.5, unit: " m" },
  { key: "lengthM", label: "Length", min: 3, max: 20, step: 0.5, unit: " m" },
  { key: "heightM", label: "Roof height", min: 2.5, max: 5, step: 0.5, unit: " m" },
  { key: "bearingDeg", label: "Turn", min: 0, max: 179, step: 1, unit: "°" },
];

function treeSize(kind, grown) {
  const tree = TREES.find((choice) => choice.key === kind);
  return grown ? { heightM: tree.heightM, crownRadiusM: tree.crownRadiusM } : YOUNG_TREE;
}

// The selected tree or shelter: what kind it is, its size and cost, and Remove. onChange takes the changed fields.
export default function ItemEditor({ item, onChange, onRemove }) {
  const isTree = item.type === "TREE";
  const Icon = isTree ? Tree : Umbrella;
  const kinds = isTree ? TREES : SHELTERS;
  const kind = kinds.find((choice) => choice.key === item.kind);
  const grown = Boolean(item.grown);

  function chooseKind(key) {
    if (isTree) return onChange({ kind: key, grown, ...treeSize(key, grown) });
    const shelter = SHELTERS.find((choice) => choice.key === key);
    onChange({ kind: key, widthM: shelter.widthM, lengthM: shelter.lengthM });
  }

  return (
    <div className="relative z-10 grid animate-enter gap-3 border-b border-line bg-white px-6.5 py-4">
      <h4 className="cond flex items-center gap-2 text-[20px]">
        <Icon size={20} weight="bold" />
        <Dropdown
          value={item.kind}
          options={kinds.map((choice) => ({ value: choice.key, label: choice.name, note: `₹${inr(choice.costInr)} · ${choice.note}` }))}
          onChange={chooseKind}
          label={isTree ? "Tree species" : "Shelter type"}
          className="cond text-[20px]"
        />
        <button type="button" onClick={onRemove} className="ml-auto flex items-center gap-1.5 text-[13.5px] font-bold tracking-normal text-severe normal-case [font-stretch:100%]">
          <Trash size={16} weight="bold" />
          Remove
        </button>
      </h4>
      <p className="-mt-1.5 text-[13px] text-muted">
        <b className="text-ink">₹{inr(itemCost(item))}</b> (estimate){isTree ? " planted, with a guard and three years of care" : ""} · {kind?.note}
      </p>
      {isTree && (
        <div className="flex gap-1.5">
          {[
            [false, `Young · ${YOUNG_TREE.heightM} m`],
            [true, `Grown · ${treeSize(item.kind, true).heightM} m`],
          ].map(([value, label]: any) => (
            <button
              key={label}
              type="button"
              aria-pressed={grown === value}
              onClick={() => onChange({ grown: value, ...treeSize(item.kind, value) })}
              className={`px-2.5 py-1 text-[13.5px] font-bold shadow-[inset_0_0_0_1.5px_var(--color-ink)] ${grown === value ? "bg-ink text-white" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {(isTree ? TREE_FIELDS : SHELTER_FIELDS).map((field) => (
        <label key={field.key} className="grid grid-cols-[104px_1fr_60px] items-center gap-3 text-[14px]">
          <span>{field.label}</span>
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={item[field.key]}
            onChange={(event) => onChange({ [field.key]: Number(event.target.value) })}
            className="accent-ink"
          />
          <output className="text-right font-[750] tabular-nums">
            {item[field.key]}
            {field.unit}
          </output>
        </label>
      ))}
      {isTree && <p className="text-[12px] text-muted">Young is the size the recommendations assume. Grown uses the species' usual height and a 6 m crown radius (Indian Roads Congress spacing of 12 m between shade trees).</p>}
    </div>
  );
}
