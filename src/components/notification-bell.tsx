"use client";

import { Bell, CheckCheck, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Notification = {
  id: string;
  title: string;
  content: string;
  read: boolean;
  link: string | null;
};

type NotificationPage = {
  notifications: Notification[];
  unreadCount: number;
  pagination?: {
    nextCursor: string | null;
    hasMore: boolean;
  };
};

const PAGE_SIZE = 20;

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [open, setOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const router = useRouter();

  /**
   * Fetch one page. `cursor` is the opaque marker the API returned with the
   * previous page; without it this is the first page and replaces the list.
   */
  const loadPage = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
    });

    if (cursor) {
      params.set("cursor", cursor);
    }

    const res = await fetch(`/api/notifications?${params}`);

    if (!res.ok) {
      throw new Error("Failed to load notifications");
    }

    const data: NotificationPage = await res.json();

    setNotifications((prev) =>
      cursor ? [...prev, ...data.notifications] : data.notifications,
    );
    setUnreadCount(data.unreadCount);
    setNextCursor(data.pagination?.nextCursor ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFirstPage() {
      try {
        await loadPage();
      } catch (err) {
        if (!cancelled) {
          console.error(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadFirstPage();

    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;

    setLoadingMore(true);

    try {
      await loadPage(nextCursor);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAllRead() {
    // Optimistic: flipping every row locally is cheap and the failure path
    // just refetches the first page to get back in sync.
    const previous = notifications;
    const previousUnread = unreadCount;

    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      const res = await fetch("/api/notifications", { method: "PATCH" });

      if (!res.ok) {
        throw new Error("Failed to mark notifications read");
      }
    } catch (err) {
      console.error(err);
      setNotifications(previous);
      setUnreadCount(previousUnread);
    }
  }

  async function dismiss(id: string) {
    const removed = notifications.find((n) => n.id === id);

    if (!removed) return;

    const previous = notifications;
    const previousUnread = unreadCount;

    setNotifications((prev) => prev.filter((n) => n.id !== id));

    if (!removed.read) {
      setUnreadCount((prev) => Math.max(prev - 1, 0));
    }

    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to dismiss notification");
      }
    } catch (err) {
      console.error(err);
      setNotifications(previous);
      setUnreadCount(previousUnread);
    }
  }

  async function openNotification(notification: Notification) {
    try {
      await fetch(`/api/notifications/${notification.id}/read`, {
        method: "PATCH",
      });

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id ? { ...n, read: true } : n,
        ),
      );

      setUnreadCount((prev) =>
        notification.read ? prev : Math.max(prev - 1, 0),
      );

      setOpen(false);

      if (notification.link) {
        router.push(notification.link);
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        className="relative rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <Bell size={20} />

        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-white">
              Notifications
            </h3>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="space-y-2 p-4 animate-pulse">
                <div className="h-12 rounded-lg bg-slate-200 dark:bg-slate-700" />
                <div className="h-12 rounded-lg bg-slate-200 dark:bg-slate-700" />
                <div className="h-12 rounded-lg bg-slate-200 dark:bg-slate-700" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No notifications yet.
              </div>
            ) : (
              <>
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`flex items-start gap-2 border-b border-slate-100 dark:border-slate-800 transition ${
                      notification.read
                        ? ""
                        : "bg-blue-50 dark:bg-slate-800"
                    }`}
                  >
                    <button
                      onClick={() => openNotification(notification)}
                      className="flex-1 text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <div className="font-medium text-slate-900 dark:text-white">
                        {notification.title}
                      </div>

                      <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                        {notification.content}
                      </p>

                      {!notification.read && (
                        <span className="inline-block mt-2 text-xs text-blue-600 font-semibold">
                          New
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      aria-label={`Dismiss ${notification.title}`}
                      onClick={() => dismiss(notification.id)}
                      className="mr-2 mt-3 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}

                {nextCursor && (
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-blue-600 hover:bg-slate-50 disabled:opacity-60 dark:text-blue-400 dark:hover:bg-slate-800"
                  >
                    {loadingMore && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {loadingMore ? "Loading..." : "Load more"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
