"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { getPusherClient } from "@/lib/pusher-client";
import RoutePickerModal from "./chat/RoutePickerModal";
import { 
  MessageSquare, Send, Compass, UserCheck, UserX, 
  MapPin, Calendar, Loader2, Sparkles, Inbox, RefreshCw 
} from "lucide-react";
import TripBoard from "@/components/TripBoard";

interface User {
  id: string;
  name: string;
  image: string | null;
  email?: string;
}

interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  otherUser: {
    id: string;
    name: string;
    image: string | null;
    bio: string | null;
    location: string | null;
  } | null;
  lastMessage: {
    id: string;
    text: string;
    createdAt: string;
    senderId: string;
  } | null;
}

interface Request {
  id: string;
  senderId: string;
  receiverId: string;
  status: string;
  sender: {
    id: string;
    name: string;
    image: string | null;
    bio: string | null;
    location: string | null;
  };
}

interface SharedRoute {
  id: string;
  tripName?: string | null;

  originName?: string | null;
  destinationName?: string | null;

  distance: number;
  duration: number;

  encodedPolyline: string;

  originLat: number;
  originLng: number;

  destinationLat: number;
  destinationLng: number;
}

export default function ChatInterface({
  currentUser,
}: {
  currentUser: User;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<Request[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [showRoutePicker, setShowRoutePicker] = useState(false);
  const [meetupPlan, setMeetupPlan] = useState<any>(null);
  const [showMeetup, setShowMeetup] = useState(false);

  const [selectedRoute, setSelectedRoute] =
  useState<SharedRoute | null>(null);
  
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pusherSubscribedChats = useRef<Set<string>>(new Set());

  // Fetch initial conversations and connection requests
  const fetchData = async () => {
    setLoadingConvs(true);
    try {
      const convRes = await fetch("/api/conversations");
      const convData = await convRes.json();
      if (convRes.ok) {
        setConversations(convData.conversations || []);
      }

      const connRes = await fetch("/api/connections");
      const connData = await connRes.json();
      if (connRes.ok) {
        setIncomingRequests(connData.incoming || []);
      }
    } catch (error) {
      console.error("Error loading chat workspace data:", error);
    } finally {
      setLoadingConvs(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Fetch messages when active conversation changes
  const fetchMessages = async (convId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/messages?conversationId=${convId}`);
      const data = await res.json();
      if (res.ok) {
        setMessages(data.messages || []);
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (activeConvId) {
      fetchMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId]);

  // Subscribe to personal pusher channel for incoming requests and accepted connections
  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher || !currentUser.id) return;

    const channelName = `private-user-${currentUser.id}`;
    const channel = pusher.subscribe(channelName);

    channel.bind("connection-request", (data: { request: Request }) => {
      setIncomingRequests((prev) => [data.request, ...prev]);
    });

    channel.bind("connection-accepted", (data: { conversationId: string; connectedUser: any }) => {
      // Reload conversations list when someone accepts our request
      fetchData();
    });

    channel.bind("conversation-updated", (data: { conversationId: string; lastMessage: any }) => {
      // Update conversations list with the new message and reorder
      setConversations((prev) => {
        const updated = prev.map((conv) => {
          if (conv.id === data.conversationId) {
            return {
              ...conv,
              lastMessage: data.lastMessage,
              updatedAt: data.lastMessage.createdAt,
            };
          }
          return conv;
        });
        // Sort by updatedAt descending
        return [...updated].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      });
    });

    return () => {
      pusher.unsubscribe(channelName);
    };
  }, [currentUser.id]);

  // Subscribe to pusher channel for active chat messages
  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher || !activeConvId) return;

    const channelName = `private-chat-${activeConvId}`;
    const currentSubscribedChats = pusherSubscribedChats.current;
    
    // Check if we are already subscribed to avoid duplicate bindings
    if (currentSubscribedChats.has(activeConvId)) return;

    const channel = pusher.subscribe(channelName);
    currentSubscribedChats.add(activeConvId);

    channel.bind("new-message", (data: { message: any }) => {
      // Add message to chat list if we are not the sender (as we add it optimistically or after API returns)
      setMessages((prev) => {
        // Prevent duplicate appending
        if (prev.some((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
    });

    return () => {
      pusher.unsubscribe(channelName);
      currentSubscribedChats.delete(activeConvId);
    };
  }, [activeConvId]);

  useEffect(() => {
  if (!activeConvId) return;

  async function loadMeetup() {
    try {
      const res = await fetch(
  `/api/meetup-plans?conversationId=${activeConvId}`
);

      if (!res.ok) return;

      const plan = await res.json();

setMeetupPlan(plan);
setShowMeetup(!!plan);
    } catch (err) {
      console.error(err);
    }
  }

  loadMeetup();
}, [activeConvId]);

  // Scroll to bottom of message list on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loadingMessages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

if (!activeConvId || sending) return;

if (!inputText.trim() && !selectedRoute) {
  return;
}

    const messageText = inputText.trim();
    const route = selectedRoute;
    setInputText("");
    setSelectedRoute(null);
    setSending(true);

    // Optimistic message object
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      text: messageText,
      route,
      createdAt: new Date().toISOString(),
      senderId: currentUser.id,
      sender: {
        id: currentUser.id,
        name: currentUser.name || "You",
        image: currentUser.image,
      },
    };

    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConvId,
          text: messageText,
          routeId: route?.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send message");

      // Replace optimistic message with actual db message
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? data.message : m))
      );

      // Update last message in the conversations sidebar list
      setConversations((prev) => {
        const updated = prev.map((conv) => {
          if (conv.id === activeConvId) {
            return {
              ...conv,
              lastMessage: data.message,
              updatedAt: data.message.createdAt,
            };
          }
          return conv;
        });
        return [...updated].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      // Remove optimistic message and show error
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      alert("Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const handleRequestAction = async (targetUserId: string, action: "accept" | "decline") => {
    setActionLoading(targetUserId);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: targetUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process request");

      // Remove from incoming requests UI list
      setIncomingRequests((prev) => prev.filter((r) => r.senderId !== targetUserId));

      if (action === "accept" && data.conversationId) {
        // Navigate or open the newly unlocked conversation
        setActiveConvId(data.conversationId);
      }

      await fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to process request.");
    } finally {
      setActionLoading(null);
    }
  };

  async function createMeetupPlan() {
  if (!activeConvId) return;

  try {
    const res = await fetch("/api/meetup-plans", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: activeConvId,
        title: "New Meetup",
        locationName: "Choose a location",
        meetupTime: new Date().toISOString(),
        notes: "",
        routeId: null,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to create meetup");
    }

    const plan = await res.json();
    setMeetupPlan(plan);
    setShowMeetup(true);
  } catch (err) {
    console.error(err);
    alert("Couldn't create meetup.");
  }
}

  const activeConv = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="flex h-[calc(100vh-140px)] rounded-2xl bg-white dark:bg-[#0A0B1E] border border-slate-100 dark:border-slate-800 shadow-xl overflow-hidden">
      {/* Sidebar List */}
      <div className="w-80 border-r border-slate-100 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-[#0F1129]/30">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
            <MessageSquare className="text-blue-500" size={18} /> Conversations
          </h2>
          <button 
            onClick={fetchData} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition"
            title="Refresh Chats"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {/* Incoming Requests Section */}
        {incomingRequests.length > 0 && (
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-amber-50/30 dark:bg-amber-950/10">
            <h3 className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Sparkles size={12} /> Pending Connections ({incomingRequests.length})
            </h3>
            <div className="space-y-3">
              {incomingRequests.map((req) => (
                <div 
                  key={req.id} 
                  className="rounded-xl border border-amber-100 dark:border-amber-900/40 bg-white dark:bg-[#11122D] p-3 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    {req.sender.image ? (
                      <Image src={req.sender.image} alt={req.sender.name} width={32} height={32} className="w-8 h-8 rounded-full object-cover" unoptimized />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-semibold">
                        {req.sender.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate text-slate-800 dark:text-white">{req.sender.name}</p>
                      {req.sender.location && (
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-0.5 mt-0.5">
                          <MapPin size={8} /> {req.sender.location}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 justify-end">
                    <button
                      disabled={actionLoading === req.senderId}
                      onClick={() => handleRequestAction(req.senderId, "decline")}
                      className="inline-flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium border border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 text-slate-500 transition"
                    >
                      <UserX size={10} /> Decline
                    </button>
                    <button
                      disabled={actionLoading === req.senderId}
                      onClick={() => handleRequestAction(req.senderId, "accept")}
                      className="inline-flex items-center gap-0.5 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-green-600 hover:bg-green-700 text-white transition shadow-sm"
                    >
                      <UserCheck size={10} /> Accept
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800">
          {loadingConvs ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 className="animate-spin text-blue-500 mb-2" size={20} />
              <span className="text-xs">Loading conversations...</span>
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-16 px-4">
              <Inbox size={28} className="text-slate-300 dark:text-slate-700 mx-auto mb-2" />
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">No active chats yet.</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-normal">
                Matches with verified travellers will show up here after accepting connection requests.
              </p>
            </div>
          ) : (
            conversations.map((conv) => {
              const other = conv.otherUser;
              if (!other) return null;
              const isActive = conv.id === activeConvId;
              const unread = false; // Add custom unread logic if needed later

              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConvId(conv.id)}
                  className={`w-full text-left p-4 flex gap-3 transition ${
                    isActive 
                      ? "bg-[#1E293B] text-white shadow-inner" 
                      : "hover:bg-slate-100/50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    {other.image ? (
                      <Image src={other.image} alt={other.name} width={40} height={40} className="w-10 h-10 rounded-full object-cover" unoptimized />
                    ) : (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${
                        isActive ? "bg-slate-700 text-white" : "bg-blue-100 dark:bg-blue-900/30 text-blue-600"
                      }`}>
                        {other.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="absolute right-0 bottom-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-white dark:border-[#0A0B1E]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                      <h4 className={`text-xs font-bold truncate ${isActive ? "text-white" : "text-slate-900 dark:text-slate-100"}`}>
                        {other.name}
                      </h4>
                      {conv.lastMessage && (
                        <span className={`text-[9px] ${isActive ? "text-slate-400" : "text-slate-400"}`}>
                          {new Date(conv.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    {other.location && (
                      <p className={`text-[10px] truncate ${isActive ? "text-slate-400" : "text-slate-500"}`}>
                        {other.location}
                      </p>
                    )}
                    <p className={`text-[11px] truncate mt-1 ${
                      isActive ? "text-slate-200" : "text-slate-600 dark:text-slate-400"
                    } ${unread ? "font-bold" : ""}`}>
                      {conv.lastMessage ? conv.lastMessage.text : "No messages yet"}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Workspace */}
      <div className="flex flex-1 flex-col min-h-0 bg-slate-50/20 dark:bg-[#0A0B1E]/10">
        {activeConvId && activeConv && activeConv.otherUser ? (
          <>
            {/* Header info */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0A0B1E] flex justify-between items-center shadow-sm">
              <div className="flex items-center gap-3">
                {activeConv.otherUser.image ? (
                  <Image src={activeConv.otherUser.image} alt={activeConv.otherUser.name} width={40} height={40} className="w-10 h-10 rounded-full object-cover" unoptimized />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-xs">
                    {activeConv.otherUser.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-sm text-slate-800 dark:text-white">{activeConv.otherUser.name}</h3>
                  {activeConv.otherUser.location && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-0.5 mt-0.5">
                      <MapPin size={10} /> {activeConv.otherUser.location}
                    </p>
                  )}
                </div>
              </div>

              {activeConv.otherUser.bio && (
                <div className="hidden md:block max-w-xs xl:max-w-sm rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2 text-[10px] text-slate-600 dark:text-slate-400 italic">
                  &quot;{activeConv.otherUser.bio}&quot;
                </div>
              )}
            </div>

            <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">

  <div className="flex items-center justify-between px-4 py-3">

    <h3 className="font-semibold">
      Meetup Plan
    </h3>

    {meetupPlan ? (
      <button
  onClick={() => setShowMeetup(!showMeetup)}
  className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
>
        {showMeetup ? "Hide" : "Open"}
      </button>
    ) : (
      <button
        onClick={createMeetupPlan}
        className="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-700"
      >
        Create Meetup
      </button>
    )}

  </div>

  {meetupPlan && showMeetup && (

    <div className="px-4 pb-4">

      <TripBoard
  meetupPlanId={meetupPlan.id}
  title={meetupPlan.title}
  location={meetupPlan.locationName}
  meetupTime={meetupPlan.meetupTime}
  notes={meetupPlan.notes}
  routeId={meetupPlan.routeId}
/>

    </div>

  )}

</div>

            {/* Messages body */}
            <div
  className="flex-1 overflow-y-auto p-4 space-y-4"
>
              {loadingMessages ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <Loader2 className="animate-spin text-blue-500 mb-2" size={24} />
                  <span className="text-xs">Fetching past messages...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-400">
                  <Sparkles size={24} className="text-blue-500 mb-2" />
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">This is the start of your conversation!</p>
                  <p className="text-[10px] mt-1 leading-normal max-w-xs">
                    Say hello to plan your itinerary, share transport, or coordinate dates. Keep things friendly and travel-safe!
                  </p>
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isMe = msg.senderId === currentUser.id;
                  const showSenderHeader = index === 0 || messages[index - 1].senderId !== msg.senderId;

                  
                  return (
                    <div 
                      key={msg.id} 
                      className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                    >
                      {!isMe && showSenderHeader && (
                        <span className="text-[9px] text-slate-400 ml-1 mb-1 font-medium">
                          {msg.sender.name}
                        </span>
                      )}
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-xs shadow-sm ${
                          isMe
                            ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-tr-none"
                            : "bg-white dark:bg-[#0F1129] border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none"
                        }`}
                      >
                        {msg.route && (
  <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-slate-900 p-3">
    <div className="font-semibold text-sm">
      📍 {msg.route.tripName || "Shared Route"}
    </div>

    <div className="text-xs mt-1">
      {msg.route.originName} → {msg.route.destinationName}
    </div>

    <div className="text-xs text-slate-500 mt-1">
      {(msg.route.distance / 1000).toFixed(1)} km
    </div>
  </div>
)}

{msg.text && (
  <p className="leading-relaxed whitespace-pre-wrap">
    {msg.text}
  </p>
)}
                      </div>
                      <span className="text-[8px] text-slate-400 mt-1 mx-1">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {selectedRoute && (
  <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 bg-blue-50 dark:bg-slate-900">
    <div className="flex items-center justify-between rounded-lg border border-blue-200 p-3">
      <div>
        <p className="text-sm font-semibold">
          {selectedRoute.tripName || "Shared Route"}
        </p>

        <p className="text-xs text-slate-500">
          {selectedRoute.originName} → {selectedRoute.destinationName}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setSelectedRoute(null)}
        className="text-red-500 text-sm"
      >
        Remove
      </button>
    </div>
  </div>
)}

            {/* Input form */}
            <form 
              onSubmit={handleSendMessage}
              className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0A0B1E] flex gap-2 items-center"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Message ${activeConv.otherUser.name}...`}
className="w-full rounded-md bg-slate-800 text-white placeholder:text-slate-400 border border-slate-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"              />
              <button
  type="button"
  onClick={() => setShowRoutePicker(true)}
  className="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
  title="Share Route"
>
  <MapPin size={16} />
</button>
              <button
                type="submit"
                disabled={!inputText.trim() || sending}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-2.5 disabled:opacity-40 transition flex-shrink-0 shadow-md hover:shadow-lg"
              >
                <Send size={15} />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400 dark:text-slate-600">
            <Compass size={40} className="text-slate-300 dark:text-slate-800 mb-4 animate-pulse" />
            <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300">Your Inbox</h3>
            <p className="text-xs max-w-sm mt-1 leading-normal">
              Select an active conversation on the left, or accept pending traveler requests to begin planning your trip together!
            </p>
          </div>
        )}
      </div>
      <RoutePickerModal
  open={showRoutePicker}
  onClose={() => setShowRoutePicker(false)}
  onSelect={(route) => {
    setSelectedRoute(route);
    setShowRoutePicker(false);
  }}
/>
    </div>
  );
}
