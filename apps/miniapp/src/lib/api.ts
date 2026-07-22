// Client gọi backend BFF. Base URL inject lúc build (VITE_API_BASE_URL).
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export interface Trip {
  id: number;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface TripEvent {
  id: number;
  tripId: number;
  title: string;
  startsAt: string;
  location: string | null;
  createdBy: string;
}

export interface Expense {
  id: number;
  tripId: number;
  title: string;
  amount: number;
  paidBy: string;
  createdAt: string;
}

export const api = {
  trips: () => request<Trip[]>("/trips"),
  trip: (id: number) => request<Trip>(`/trips/${id}`),
  events: (tripId: number) => request<TripEvent[]>(`/trips/${tripId}/events`),
  expenses: (tripId: number) => request<Expense[]>(`/trips/${tripId}/expenses`)
};
