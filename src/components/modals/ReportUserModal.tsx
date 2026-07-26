"use client";

import { AlertCircle, Loader2 } from "lucide-react";

interface ReportUserModalProps {
  isOpen: boolean;
  userName: string;
  reason: string;
  setReason: (val: string) => void;
  details: string;
  setDetails: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function ReportUserModal({
  isOpen,
  userName,
  reason,
  setReason,
  details,
  setDetails,
  onSubmit,
  onCancel,
  isLoading = false,
}: ReportUserModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#0F1129] border border-gray-200 dark:border-gray-800 shadow-2xl p-6">
        <div className="flex items-center gap-2 text-amber-500 mb-4">
          <AlertCircle size={22} />
          <h4 className="font-bold text-gray-950 dark:text-white text-base">
            Report {userName}
          </h4>
        </div>
        <form onSubmit={onSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Reason
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-xl bg-gray-50 dark:bg-[#1A1C3D] border border-gray-100 dark:border-gray-800 px-3 py-2.5 text-sm text-gray-800 dark:text-white outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="Inappropriate behavior">Inappropriate behavior</option>
                <option value="Spam or scams">Spam or scams</option>
                <option value="Fake profile">Fake profile / Impersonation</option>
                <option value="Harassment">Harassment or abusive language</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Details (Optional)
              </label>
              <textarea
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Provide additional details to help our moderation team..."
                className="w-full rounded-xl bg-gray-50 dark:bg-[#1A1C3D] border border-gray-100 dark:border-gray-800 px-3 py-2.5 text-sm text-gray-800 dark:text-white outline-none focus:ring-1 focus:ring-amber-500 resize-none"
              />
            </div>
          </div>
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
              type="submit"
              disabled={isLoading}
              className="flex-1 rounded-xl bg-amber-500 text-white px-4 py-2.5 text-xs font-semibold hover:bg-amber-600 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Submitting...
                </>
              ) : (
                "Submit Report"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
