"use client";

import { ShieldAlert, Loader2 } from "lucide-react";

interface BlockUserModalProps {
  isOpen: boolean;
  userName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function BlockUserModal({
  isOpen,
  userName,
  onConfirm,
  onCancel,
  isLoading = false,
}: BlockUserModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#0F1129] border border-gray-200 dark:border-gray-800 shadow-2xl p-6 text-center">
        <div className="rounded-full bg-rose-50 dark:bg-rose-500/10 p-4 text-rose-500 w-fit mx-auto mb-4">
          <ShieldAlert size={32} />
        </div>
        <h4 className="font-bold text-gray-950 dark:text-white text-base">
          Block {userName}?
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          You won&apos;t see each other&apos;s posts or matching trips. This action is immediate and cannot be undone easily.
        </p>
        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 rounded-xl bg-rose-500 text-white px-4 py-2.5 text-xs font-semibold hover:bg-rose-600 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Blocking...
              </>
            ) : (
              "Block"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
