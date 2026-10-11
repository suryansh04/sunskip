import { Compass, Cursor, HandPointing, Tree, Umbrella } from "@phosphor-icons/react";
import { SHELTERS, TREES } from "../costs";
import { inr } from "../format";
import Dropdown from "./Dropdown";

const TOOLS = [
  { key: "move", label: "Select and move", icon: Cursor },
  { key: "TREE", label: "Add a tree", icon: Tree },
  { key: "SHELTER", label: "Add a shelter", icon: Umbrella },
];

// The simulator's controls over the map: tools, Before / After, and what a click will add.
// The panel has no position of its own, so these are placed in <main> over the map.
// planNote says the items on the map are a plan, not what stands there today
export default function SimOverlays({ tool, onTool, onResetView, showView, view, onView, treeKind, onTreeKind, shelterKind, onShelterKind, planNote }) {
  const adding = tool === "TREE" ? { list: TREES, value: treeKind, onPick: onTreeKind } : { list: SHELTERS, value: shelterKind, onPick: onShelterKind };
  return (
    <>
      <div role="toolbar" aria-label="Simulator tools" className="absolute top-5 left-5 z-[3] flex flex-col bg-ink">
        {TOOLS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={tool === key}
            onClick={() => onTool(key)}
            className={`grid size-[50px] place-items-center border-b border-barline ${tool === key ? "bg-white text-ink" : "text-bartext hover:text-white"}`}
          >
            <Icon size={23} weight="bold" />
          </button>
        ))}
        <button type="button" aria-label="Reset the 3D view" title="Reset the 3D view" onClick={onResetView} className="grid size-[50px] place-items-center text-bartext hover:text-white">
          <Compass size={23} weight="bold" />
        </button>
      </div>
      {planNote && (
        <div className="absolute top-5 left-[calc((100%-560px)/2)] z-[3] -translate-x-1/2 border-2 border-ink bg-white px-3.5 py-2 text-[13.5px] whitespace-nowrap">
          <b className="font-bold">{planNote.from}</b> · {planNote.what} · <span className="text-muted">not what stands there today</span>
        </div>
      )}
      {showView && (
        <div className="absolute top-5 right-[580px] z-[3] flex border-2 border-ink bg-white">
          {["before", "after"].map((which) => (
            <button key={which} type="button" aria-pressed={view === which} onClick={() => onView(which)} className={`px-4 py-2 text-[14px] font-bold capitalize ${view === which ? "bg-ink text-white" : ""}`}>
              {which}
            </button>
          ))}
        </div>
      )}
      <div className="absolute bottom-6 left-[calc((100%-560px)/2)] z-[3] flex -translate-x-1/2 items-center gap-2 border-2 border-ink bg-white px-3.5 py-2 text-[13.5px] whitespace-nowrap">
        <HandPointing size={18} weight="bold" />
        {tool === "move" ? (
          "Drag a tree or shelter to move it · right-drag to turn the view"
        ) : (
          <>
            Click a path to add a
            <Dropdown
              up
              value={adding.value}
              options={adding.list.map((choice) => ({ value: choice.key, label: `${choice.name} · ₹${inr(choice.costInr)}`, note: choice.note }))}
              onChange={adding.onPick}
              label="What to add"
            />
          </>
        )}
      </div>
    </>
  );
}
