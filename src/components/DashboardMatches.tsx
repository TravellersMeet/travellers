"use client";

import { useState, useEffect, useCallback } from "react";
import { Compass, UserPlus, Check, X, MessageSquare, MapPin, Calendar, RefreshCw, Loader2, ShieldAlert, Flag } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import BlockUserModal from "./modals/BlockUserModal";
import ReportUserModal from "./modals/ReportUserModal";

interface Match {
  id: string;
  userId: string;
  destination: string;
  departureDate: string;
  ticketUrl: string;
  status: string;
  relevanceScore: number;
  user: {
    id: string;
    name: string;
    image: string | null;
    bio: string | null;
    location: string | null;
    languages?: string[];
    travelInterests?: string[];
    accommodationPrefs?: string[];
    budgetRange?: string | null;
    age?: number | null;
    gender?: string | null;
    travelStyle?: string | null;
  };
}

interface Connection {
  requestId: string;
  user: {
    id: string;
    name: string;
    image: string | null;
  };
  connectedAt: string;
}

interface Request {
  id: string;
  senderId: string;
  receiverId: string;
  status: string;
  sender?: {
    id: string;
    name: string;
    image: string | null;
  };
  receiver?: {
    id: string;
    name: string;
    image: string | null;
  };
}

export default function DashboardMatches({
  destination,
  departureDate,
}: {
  destination: string;
  departureDate: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<Request[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<Request[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Moderation
  const [blockingUser, setBlockingUser] = useState<Match | null>(null);
  const [reportingUser, setReportingUser] = useState<Match | null>(null);
  const [reportReason, setReportReason] = useState("Inappropriate behavior");
  const [reportDetails, setReportDetails] = useState("");
  const [submittingModeration, setSubmittingModeration] = useState(false);

  // Advanced Matching Filters
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [genderFilter, setGenderFilter] = useState("All");
  const [tripPurposeFilter, setTripPurposeFilter] = useState("All");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const fetchMatchesAndConnections = useCallback(
    async (pageNum: number = 1, append: boolean = false) => {
      setLoading(true);
      setError(null);
      try {
        const dateStr = new Date(departureDate).toISOString().split("T")[0];
        let urlStr = `/api/matches?destination=${encodeURIComponent(
          destination
        )}&date=${dateStr}&page=${pageNum}&limit=6`;

        if (genderFilter && genderFilter !== "All") {
          urlStr += `&gender=${encodeURIComponent(genderFilter)}`;
        }
        if (tripPurposeFilter && tripPurposeFilter !== "All") {
          urlStr += `&tripPurpose=${encodeURIComponent(tripPurposeFilter)}`;
        }
        if (ageMin) {
          urlStr += `&ageMin=${encodeURIComponent(ageMin)}`;
        }
        if (ageMax) {
          urlStr += `&ageMax=${encodeURIComponent(ageMax)}`;
        }
        if (customStartDate) {
          urlStr += `&startDate=${encodeURIComponent(customStartDate)}`;
        }
        if (customEndDate) {
          urlStr += `&endDate=${encodeURIComponent(customEndDate)}`;
        }

        // Fetch Matches
        const matchRes = await fetch(urlStr);
        const matchData = await matchRes.json();

        if (!matchRes.ok) {
          throw new Error(matchData.error || "Failed to load matches");
        }

        // Fetch Connections
        const connRes = await fetch("/api/connections");
        const connData = await connRes.json();

        if (!connRes.ok) {
          throw new Error(connData.error || "Failed to load connections");
        }

        if (append) {
          setMatches((prev) => [...prev, ...(matchData.matches || [])]);
        } else {
          setMatches(matchData.matches || []);
        }

        setHasMore(matchData.hasMore || false);
        setPage(pageNum);

        setConnections(connData.connections || []);
        setIncomingRequests(connData.incoming || []);
        setOutgoingRequests(connData.outgoing || []);
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Something went wrong while fetching matches.");
      } finally {
        setLoading(false);
      }
    },
    [
      departureDate,
      destination,
      genderFilter,
      tripPurposeFilter,
      ageMin,
      ageMax,
      customStartDate,
      customEndDate,
    ]
  );

  useEffect(() => {
    if (isOpen) {
      fetchMatchesAndConnections(1, false);
    }
  }, [
    isOpen,
    genderFilter,
    tripPurposeFilter,
    ageMin,
    ageMax,
    customStartDate,
    customEndDate,
    fetchMatchesAndConnections,
  ]);

  const handleLoadMore = () => {
    fetchMatchesAndConnections(page + 1, true);
  };

  const handleBlockUser = async (targetMatch: Match) => {
    setSubmittingModeration(true);
    try {
      const res = await fetch("/api/user/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockedId: targetMatch.userId }),
      });
      if (res.ok) {
        alert(`${targetMatch.user.name} has been blocked.`);
        setMatches((prev) => prev.filter((m) => m.userId !== targetMatch.userId));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to block user.");
      }
    } catch (err) {
      console.error(err);
      alert("Error blocking user.");
    } finally {
      setSubmittingModeration(false);
      setBlockingUser(null);
    }
  };

  const handleReportUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportingUser) return;
    setSubmittingModeration(true);
    try {
      const res = await fetch("/api/user/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportedId: reportingUser.userId,
          reason: reportReason,
          details: reportDetails,
        }),
      });
      if (res.ok) {
        alert("Profile reported successfully.");
        setReportDetails("");
        setReportingUser(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to report user.");
      }
    } catch (err) {
      console.error(err);
      alert("Error reporting user.");
    } finally {
      setSubmittingModeration(false);
    }
  };

  const handleConnect = async (targetUserId: string) => {
    setActionLoading(targetUserId);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", userId: targetUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send request");

      await fetchMatchesAndConnections(page, false);
    } catch (err: any) {
      alert(err.message || "Failed to send request.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleAccept = async (targetUserId: string) => {
    setActionLoading(targetUserId);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", userId: targetUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to accept connection");

      await fetchMatchesAndConnections(page, false);
    } catch (err: any) {
      alert(err.message || "Failed to accept request.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async (targetUserId: string) => {
    setActionLoading(targetUserId);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline", userId: targetUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to decline connection");

      await fetchMatchesAndConnections(page, false);
    } catch (err: any) {
      alert(err.message || "Failed to decline request.");
    } finally {
      setActionLoading(null);
    }
  };

  const getConnectionState = (targetUserId: string) => {
    const isAccepted = connections.some((c) => c.user.id === targetUserId);
    if (isAccepted) return "ACCEPTED";

    const isIncoming = incomingRequests.some((r) => r.senderId === targetUserId);
    if (isIncoming) return "INCOMING";

    const isOutgoing = outgoingRequests.some((r) => r.receiverId === targetUserId);
    if (isOutgoing) return "OUTGOING";

    return "NONE";
  };

  return (
    <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl transition bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
      >
        <Compass size={16} className={loading && matches.length === 0 ? "animate-spin text-blue-500" : "text-blue-500"} />
        {isOpen ? "Hide Matches" : "Find Matches"}
      </button>

      {isOpen && (
        <div className="mt-4 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/80 p-4 transition-all duration-300">
          
          {/* Header & Filter Toggle */}
          <div className="flex items-center justify-between mb-4 border-b border-slate-100/50 dark:border-slate-800/50 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Verified Matches</h3>
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className="text-xs inline-flex items-center gap-1 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-indigo-400 font-semibold transition"
            >
              Filter Matches {isFilterOpen ? "▲" : "▼"}
            </button>
          </div>

          {/* Expandable Filter Panel */}
          {isFilterOpen && (
            <div className="mb-5 grid gap-4 sm:grid-cols-2 md:grid-cols-4 rounded-xl bg-slate-100/50 dark:bg-slate-900/50 border border-slate-200/40 dark:border-slate-800/40 p-4">
              {/* Gender Preference */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Gender</label>
                <select
                  value={genderFilter}
                  onChange={(e) => setGenderFilter(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-1.5 bg-white dark:bg-[#0A0B1E] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                >
                  <option value="All">All Genders</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                </select>
              </div>

              {/* Trip Purpose */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Purpose</label>
                <select
                  value={tripPurposeFilter}
                  onChange={(e) => setTripPurposeFilter(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-1.5 bg-white dark:bg-[#0A0B1E] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                >
                  <option value="All">All Purposes</option>
                  <option value="Leisure">Leisure</option>
                  <option value="Business">Business</option>
                  <option value="Adventure">Adventure</option>
                </select>
              </div>

              {/* Age Range */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Age Range</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={ageMin}
                    onChange={(e) => setAgeMin(e.target.value)}
                    placeholder="Min"
                    min={18}
                    max={99}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-800 px-2 py-1.5 bg-white dark:bg-[#0A0B1E] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                  />
                  <span className="text-slate-400 text-xs">-</span>
                  <input
                    type="number"
                    value={ageMax}
                    onChange={(e) => setAgeMax(e.target.value)}
                    placeholder="Max"
                    min={18}
                    max={99}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-800 px-2 py-1.5 bg-white dark:bg-[#0A0B1E] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                  />
                </div>
              </div>

              {/* Departure Dates */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Custom Dates</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-800 px-1 py-1.5 bg-white dark:bg-[#0A0B1E] text-[10px] outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                  />
                  <span className="text-slate-400 text-xs">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-800 px-1 py-1.5 bg-white dark:bg-[#0A0B1E] text-[10px] outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 dark:text-slate-200"
                  />
                </div>
              </div>
            </div>
          )}

          {loading && matches.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-blue-500 mr-2" size={20} />
              <span className="text-sm text-slate-500">Searching matching verified itineraries...</span>
            </div>
          ) : error ? (
            <div className="text-center py-6">
              <p className="text-sm text-red-500">{error}</p>
              <button
                onClick={() => fetchMatchesAndConnections(1, false)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-blue-500 hover:underline"
              >
                <RefreshCw size={12} /> Try Again
              </button>
            </div>
          ) : matches.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No matching verified travelers found matching your criteria.
              </p>
            </div>
          ) : (
            <div>
              <div className="grid gap-4 sm:grid-cols-2">
                {matches.map((match) => {
                  const connState = getConnectionState(match.userId);
                  const isUserActionLoading = actionLoading === match.userId;

                  return (
                    <div
                      key={match.id}
                      className="flex flex-col justify-between rounded-xl bg-white dark:bg-[#0F1129] border border-slate-150 dark:border-slate-800 p-4 shadow-sm transition hover:shadow-md hover:translate-y-[-2px] duration-200"
                    >
                      <div>
                        <div className="flex items-start gap-3">
                          {match.user.image ? (
                            <Image
                              src={match.user.image}
                              alt={match.user.name}
                              width={44}
                              height={44}
                              className="w-11 h-11 rounded-full object-cover border-2 border-blue-500/20"
                              unoptimized
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm">
                              {match.user.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="font-semibold text-sm truncate dark:text-white flex items-center gap-1.5">
                                {match.user.name}
                                {match.user.age && (
                                  <span className="text-xs text-slate-400 font-normal">({match.user.age})</span>
                                )}
                              </h4>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">
                                  {match.relevanceScore}% Match
                                </span>
                                <button
                                  onClick={() => setReportingUser(match)}
                                  title="Report Profile"
                                  className="p-1 text-slate-400 hover:text-amber-500 rounded transition"
                                >
                                  <Flag size={12} />
                                </button>
                                <button
                                  onClick={() => setBlockingUser(match)}
                                  title="Block User"
                                  className="p-1 text-slate-400 hover:text-red-500 rounded transition"
                                >
                                  <ShieldAlert size={12} />
                                </button>
                              </div>
                            </div>
                            {(match.user.location || match.user.gender) && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center flex-wrap gap-x-2 mt-0.5">
                                {match.user.location && (
                                  <span className="flex items-center gap-1">
                                    <MapPin size={12} /> {match.user.location}
                                  </span>
                                )}
                                {match.user.gender && (
                                  <span className="opacity-60">• {match.user.gender}</span>
                                )}
                              </p>
                            )}
                          </div>
                      </div>

                      {match.user.bio && (
                          <p className="mt-3 text-xs text-slate-600 dark:text-slate-300 line-clamp-2 italic bg-slate-50/80 dark:bg-slate-800/40 p-2 rounded-lg border border-slate-100/50 dark:border-slate-800/40">
                            &quot;{match.user.bio}&quot;
                          </p>
                        )}

                        <div className="mt-3 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span className="flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400">
                            <Compass size={12} /> {match.destination}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar size={12} /> {new Date(match.departureDate).toLocaleDateString()}
                          </span>
                        </div>

                        {/* Rich profile details badges */}
                        {(match.user.languages?.length || match.user.budgetRange || match.user.travelInterests?.length || match.user.travelStyle) && (
                          <div className="mt-3.5 pt-3 border-t border-slate-100/50 dark:border-slate-800/40 space-y-2">
                            {match.user.languages && match.user.languages.length > 0 && (
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                💬 Speaks: <span className="font-semibold text-slate-700 dark:text-slate-300">{match.user.languages.join(", ")}</span>
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                              {match.user.budgetRange && (
                                <p>
                                  💰 Budget: <span className="font-semibold text-slate-700 dark:text-slate-300">{match.user.budgetRange}</span>
                                </p>
                              )}
                              {match.user.travelStyle && (
                                <p>
                                  ✈️ Style: <span className="font-semibold text-slate-700 dark:text-slate-300">{match.user.travelStyle}</span>
                                </p>
                              )}
                            </div>
                            {match.user.travelInterests && match.user.travelInterests.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {match.user.travelInterests.map((interest) => (
                                  <span
                                    key={interest}
                                    className="text-[9px] bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-semibold"
                                  >
                                    {interest}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-50 dark:border-slate-800/60 flex justify-end">
                        {isUserActionLoading ? (
                          <button
                            disabled
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-400 dark:bg-slate-800"
                          >
                            <Loader2 size={13} className="animate-spin" /> Processing...
                          </button>
                        ) : connState === "NONE" ? (
                          <button
                            onClick={() => handleConnect(match.userId)}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 transition"
                          >
                            <UserPlus size={13} /> Connect
                          </button>
                        ) : connState === "OUTGOING" ? (
                          <span className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30">
                            Request Sent
                          </span>
                        ) : connState === "INCOMING" ? (
                          <div className="flex gap-2 w-full sm:w-auto">
                            <button
                              onClick={() => handleDecline(match.userId)}
                              className="inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-red-500 transition dark:border-slate-800 dark:hover:bg-slate-800"
                              title="Decline"
                            >
                              <X size={14} />
                            </button>
                            <button
                              onClick={() => handleAccept(match.userId)}
                              className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 transition shadow-sm"
                            >
                              <Check size={13} /> Accept
                            </button>
                          </div>
                        ) : (
                          <Link
                            href="/dashboard/messages"
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white shadow-sm transition"
                          >
                            <MessageSquare size={13} /> Message
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More Pagination Button */}
              {hasMore && (
                <div className="mt-6 flex justify-center border-t border-slate-100/50 dark:border-slate-800/50 pt-4">
                  <button
                    onClick={handleLoadMore}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs font-semibold text-slate-600 dark:text-slate-300 transition shadow-sm"
                  >
                    {loading && <Loader2 size={13} className="animate-spin" />}
                    Load More Matches
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Global Block Confirmation Overlay */}
      <BlockUserModal
        isOpen={Boolean(blockingUser)}
        userName={blockingUser?.user.name || ""}
        onConfirm={() => blockingUser && handleBlockUser(blockingUser)}
        onCancel={() => setBlockingUser(null)}
        isLoading={submittingModeration}
      />

      {/* Global Report Profile Overlay */}
      <ReportUserModal
        isOpen={Boolean(reportingUser)}
        userName={reportingUser?.user.name || ""}
        reason={reportReason}
        setReason={setReportReason}
        details={reportDetails}
        setDetails={setReportDetails}
        onSubmit={handleReportUser}
        onCancel={() => setReportingUser(null)}
        isLoading={submittingModeration}
      />
    </div>
  );
}
