"use client";

import { useEffect, useState } from "react";
import { RouteViewer } from "./route-viewer";
import { CalendarDays, MapPin, NotebookPen, CheckSquare, Pencil, Check, X, } from "lucide-react";

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

interface TripBoardProps {
  meetupPlanId: string;

  title: string;
  location: string;
  meetupTime: string;
  notes?: string;

  routeId?: string;
}

export default function TripBoard({
  meetupPlanId,
  title,
  location,
  meetupTime,
  notes,
  routeId,
}: TripBoardProps) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(true);
  useEffect(() => {
  async function loadChecklist() {
    try {
      setLoadingChecklist(true);

      const res = await fetch(
        `/api/meetup-checklist?meetupPlanId=${meetupPlanId}`
      );

      if (!res.ok) return;

      const data = await res.json();

      setItems(data);
    } finally {
      setLoadingChecklist(false);
    }
  }

  loadChecklist();
}, [meetupPlanId]);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
const [editingText, setEditingText] = useState("");

  async function addItem() {
  if (!text.trim()) return;

  const res = await fetch("/api/meetup-checklist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      meetupPlanId,
      text,
    }),
  });

  if (!res.ok) return;

  const item = await res.json();

  setItems((prev) => [...prev, item]);

  setText("");
}

  async function toggle(id: string) {
  const item = items.find((i) => i.id === id);

  if (!item) return;

  const completed = !item.completed;

  const res = await fetch("/api/meetup-checklist", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id,
      completed,
    }),
  });

  if (!res.ok) return;

  setItems((prev) => {
    const updated = prev.map((i) =>
      i.id === id
        ? { ...i, completed }
        : i
    );

    return updated.sort(
      (a, b) => Number(a.completed) - Number(b.completed)
    );
  });
}

async function saveEdit(id: string) {
  if (!editingText.trim()) return;

  const res = await fetch("/api/meetup-checklist", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id,
      text: editingText,
    }),
  });

  if (!res.ok) return;

  setItems((prev) =>
    prev.map((item) =>
      item.id === id
        ? {
            ...item,
            text: editingText,
          }
        : item
    )
  );

  setEditingId(null);
  setEditingText("");
}

  return (
    <div className="space-y-6 max-h-[420px] overflow-y-auto pr-2">

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm">

  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
    {title}
  </h2>

  <div className="mt-6 space-y-5">

    <div className="flex items-start gap-3">
      <MapPin className="h-5 w-5 text-blue-600 mt-0.5" />
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Meetup Location
        </p>
        <p className="font-medium text-slate-900 dark:text-white">
          {location}
        </p>
      </div>
    </div>

    <div className="flex items-start gap-3">
      <CalendarDays className="h-5 w-5 text-blue-600 mt-0.5" />
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Meetup Time
        </p>
        <p className="font-medium text-slate-900 dark:text-white">
          {new Date(meetupTime).toLocaleString()}
        </p>
      </div>
    </div>

    {notes && (
      <div className="border-t border-slate-200 dark:border-slate-700 pt-5">
        <div className="flex items-center gap-2 mb-2">
          <NotebookPen className="h-4 w-4 text-blue-600" />
          <h4 className="font-semibold text-slate-900 dark:text-white">
            Shared Notes
          </h4>
        </div>

        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
          {notes}
        </p>
      </div>
    )}

  </div>

</div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">

        <div className="mb-5 flex items-center gap-2">
  <CheckSquare className="h-5 w-5 text-blue-600" />

  <h3 className="font-semibold text-slate-900 dark:text-white">
    Shared Checklist
  </h3>
</div>

        <div className="flex flex-col gap-3 sm:flex-row">

          <input
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add checklist item..."
          />

          <button
  onClick={addItem}
  disabled={!text.trim()}
className="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap">
  Add Item
</button>

        </div>

        <div className="mt-4 space-y-2">

 {loadingChecklist ? (
  <div className="space-y-2 animate-pulse">
    <div className="h-12 rounded-lg bg-slate-200 dark:bg-slate-700" />
    <div className="h-12 rounded-lg bg-slate-200 dark:bg-slate-700" />
    <div className="h-12 rounded-lg bg-slate-200 dark:bg-slate-700" />
  </div>
) : items.length === 0 ? (
  <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-8 text-center">
    <CheckSquare className="mx-auto mb-3 h-8 w-8 text-slate-400" />

    <p className="font-medium text-slate-600 dark:text-slate-300">
      No checklist items yet
    </p>

    <p className="mt-1 text-sm text-slate-500">
      Add tasks that both travellers can complete together.
    </p>
  </div>
) : (
  <>
    {items.map((item) => (
      <label
        key={item.id}
        className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition
          ${
            item.completed
              ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20"
              : "border-slate-200 dark:border-slate-700 hover:border-blue-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          }`}
      >
        <input
          type="checkbox"
          checked={item.completed}
          onChange={() => toggle(item.id)}
          className="h-4 w-4 accent-blue-600"
        />

        <div className="flex flex-1 items-center justify-between gap-2">

  {editingId === item.id ? (
    <input
      value={editingText}
      onChange={(e) => setEditingText(e.target.value)}
      className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      autoFocus
    />
  ) : (
    <span
      className={`flex-1 ${
        item.completed
          ? "line-through text-slate-400"
          : "text-slate-900 dark:text-white"
      }`}
    >
      {item.text}
    </span>
  )}

  {editingId === item.id ? (
    <div className="flex gap-1">
      <button
        type="button"
        onClick={() => saveEdit(item.id)}
        className="rounded p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30"
      >
        <Check className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => {
          setEditingId(null);
          setEditingText("");
        }}
        className="rounded p-1 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => {
        setEditingId(item.id);
        setEditingText(item.text);
      }}
      className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      <Pencil className="h-4 w-4" />
    </button>
  )}

</div>
      </label>
    ))}
  </>
)}
    </div>

      </div>

      {routeId && (

  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">

    <h3 className="mb-4 font-semibold text-slate-900 dark:text-white">
      Shared Route
    </h3>

    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
      <RouteViewer
        routeId={routeId}
        allowCaching
        showControls
      />
    </div>

  </div>

)}
    </div>
  );
}