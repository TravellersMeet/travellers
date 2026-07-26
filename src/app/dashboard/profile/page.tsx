"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Camera, MapPin, Calendar, Mail, Phone, ShieldCheck, ArrowRight } from "lucide-react";

interface ProfileData {
  name: string;
  email: string;
  bio: string | null;
  location: string | null;
  homeLocation: string | null;
  image: string | null;
  emailVerified: boolean;
  phone: string | null;
  createdAt: string;
  languages?: string[];
  travelInterests?: string[];
  accommodationPrefs?: string[];
  budgetRange?: string | null;
  socialLinks?: string[];
  age?: number | null;
  gender?: string | null;
  travelStyle?: string | null;
}

interface RouteItem {
  id: string;
  tripName: string | null;
  originName: string | null;
  destinationName: string | null;
  distance: number;
  duration: number;
  createdAt: string;
}

export default function ProfileViewPage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [trips, setTrips] = useState<RouteItem[]>([]);
  const [ticketVerified, setTicketVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, routesRes, ticketsRes] = await Promise.all([
          fetch("/api/user/profile"),
          fetch("/api/routes?limit=3"),
          fetch("/api/tickets?limit=100"),
        ]);

        if (profileRes.ok) setProfile(await profileRes.json());
        if (routesRes.ok) {
          const { items } = await routesRes.json();
          setTrips(items.slice(0, 3));
        }
        if (ticketsRes.ok) {
          const { items: tickets } = await ticketsRes.json();
          setTicketVerified(tickets?.some((t: { status: string }) => t.status === "VERIFIED"));
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto animate-pulse">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-800 rounded mb-8" />
        <div className="h-96 bg-gray-100 dark:bg-gray-900 rounded-[32px]" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-5xl mx-auto text-center py-20 text-gray-500">
        Couldn&apos;t load your profile. Please try refreshing.
      </div>
    );
  }

  const memberSince = new Date(profile.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Profile</h1>
        <Link
          href="/dashboard/profile/edit"
          className="rounded-lg bg-[#1A4D2E] text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition"
        >
          Edit Profile
        </Link>
      </div>

      <div className="rounded-[32px] border border-gray-100 dark:border-gray-800 bg-[#F6F4EC] dark:bg-[#11132B] p-8 md:p-12 shadow-sm">
        <div className="grid md:grid-cols-[280px_1fr] gap-12 lg:gap-16">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-64 h-64 rounded-full overflow-hidden bg-white dark:bg-[#1A1C3D] shadow-inner">
              {profile.image ? (
                <Image src={profile.image} alt={profile.name} fill className="object-cover" unoptimized />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  <Camera size={32} />
                </div>
              )}
            </div>
            {ticketVerified && (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                <ShieldCheck size={16} /> Ticket Verified
              </span>
            )}
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Member since {memberSince}
            </span>
          </div>

          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{profile.name}</h2>
              {profile.bio && (
                <p className="mt-2 text-gray-600 dark:text-gray-400">{profile.bio}</p>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <Mail size={16} className="text-gray-400 shrink-0" />
                {profile.email}
                {profile.emailVerified && <ShieldCheck size={14} className="text-emerald-500" />}
              </div>
              {profile.phone && (
                <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <Phone size={16} className="text-gray-400 shrink-0" />
                  {profile.phone}
                </div>
              )}
              {profile.location && (
                <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <MapPin size={16} className="text-gray-400 shrink-0" />
                  Currently in {profile.location}
                </div>
              )}
              {profile.homeLocation && (
                <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <MapPin size={16} className="text-gray-400 shrink-0" />
                  From {profile.homeLocation}
                </div>
              )}
            </div>

            {/* Extended Profile Fields */}
            <div className="border-t border-slate-200 dark:border-slate-800/80 pt-6 space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">Languages Spoken</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {profile.languages?.length ? profile.languages.join(", ") : "Not set"}
                  </p>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">Budget Range</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {profile.budgetRange || "Not set"}
                  </p>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">Travel Style</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {profile.travelStyle || "Not set"}
                  </p>
                </div>
              </div>

              {(profile.age || profile.gender) && (
                <div className="grid gap-4 sm:grid-cols-3">
                  {profile.age && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">Age</h4>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{profile.age} years old</p>
                    </div>
                  )}
                  {profile.gender && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">Gender</h4>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{profile.gender}</p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 block">Travel Interests</h4>
                <div className="flex flex-wrap gap-1.5">
                  {profile.travelInterests?.length ? (
                    profile.travelInterests.map((interest) => (
                      <span key={interest} className="text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 px-2.5 py-1 rounded-full font-medium">
                        {interest}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-gray-500">None selected</span>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 block">Preferred Accommodation</h4>
                <div className="flex flex-wrap gap-1.5">
                  {profile.accommodationPrefs?.length ? (
                    profile.accommodationPrefs.map((pref) => (
                      <span key={pref} className="text-xs bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-full font-medium">
                        {pref}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-gray-500">None selected</span>
                  )}
                </div>
              </div>

              {profile.socialLinks && profile.socialLinks.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 block">Social Links</h4>
                  <div className="flex flex-wrap gap-3">
                    {profile.socialLinks.map((link) => {
                      const isInstagram = link.includes("instagram.com");
                      return (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-xl transition"
                        >
                          {isInstagram ? "Instagram" : "Twitter/X"}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Recent Trips
                </h3>
                <Link href="/routes" className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 hover:underline">
                  View all <ArrowRight size={12} />
                </Link>
              </div>

              {trips.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-500">No trips saved yet.</p>
              ) : (
                <div className="space-y-2">
                  {trips.map((trip) => (
                    <div key={trip.id} className="flex items-center justify-between rounded-xl bg-white dark:bg-[#0F1129] px-4 py-3 text-sm">
                      <div className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                        <Calendar size={14} className="text-gray-400" />
                        {trip.tripName || `${trip.originName ?? "?"} → ${trip.destinationName ?? "?"}`}
                      </div>
                      <span className="text-gray-500 dark:text-gray-500">
                        {(trip.distance / 1000).toFixed(0)} km
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}