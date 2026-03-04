"use client";

import { useState, useEffect } from "react";

const API = "http://localhost:8000";

interface CardResult {
  ppn: string;
  subtitle: string;
  description: string;
  place: string;
  date: string;
  iiif_image_url: string;
  local_image_url: string;
  score: number;
}

interface SearchResponse {
  results: CardResult[];
  total_candidates: number;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardResult[]>([]);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const [places, setPlaces] = useState<string[]>([]);
  const [yearMin, setYearMin] = useState(1700);
  const [yearMax, setYearMax] = useState(1950);
  const [selectedPlace, setSelectedPlace] = useState("");
  const [yearFrom, setYearFrom] = useState<number | "">("");
  const [yearTo, setYearTo] = useState<number | "">("");

  useEffect(() => {
    fetch(`${API}/facets`)
      .then((r) => r.json())
      .then((d) => {
        setPlaces(d.places);
        setYearMin(d.year_min);
        setYearMax(d.year_max);
      })
      .catch(() => {});
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setAnswer("");
    setResults([]);
    try {
      const body: Record<string, unknown> = { query, top_k: 6 };
      if (selectedPlace) body.place = selectedPlace;
      if (yearFrom !== "") body.year_from = Number(yearFrom);
      if (yearTo !== "") body.year_to = Number(yearTo);
      const res = await fetch(`${API}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: SearchResponse = await res.json();
      setResults(data.results);
    } catch {
      setError("Could not reach the API. Is uvicorn running?");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    if (!results.length) return;
    setGenerating(true);
    setAnswer("");
    try {
      const res = await fetch(`${API}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, results }),
      });
      const data = await res.json();
      setAnswer(data.answer);
    } catch {
      setAnswer("Generation failed — is Ollama running?");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <header className="bg-stone-900 text-stone-100 px-6 py-5">
        <h1 className="text-2xl font-bold tracking-tight">Menu Card Search</h1>
        <p className="text-stone-400 text-sm mt-1">
          2,403 historical menus from the Staatsbibliothek zu Berlin
        </p>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <form onSubmit={handleSearch} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. elegant dinner on an ocean liner"
              className="flex-1 rounded-lg border border-stone-300 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-stone-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-stone-800 text-white px-6 py-3 rounded-lg font-medium hover:bg-stone-700 disabled:opacity-50 transition"
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </div>

          <div className="flex flex-wrap gap-3 items-center text-sm">
            <input
              type="text"
              value={selectedPlace}
              onChange={(e) => setSelectedPlace(e.target.value)}
              placeholder="Filter by place (e.g. Berlin, Norddeutscher)"
              className="rounded border border-stone-300 px-3 py-2 bg-white text-stone-700 w-72"
            />
            <span className="text-stone-500">Year:</span>
            <input
              type="number"
              value={yearFrom}
              onChange={(e) =>
                setYearFrom(e.target.value ? Number(e.target.value) : "")
              }
              placeholder={String(yearMin)}
              min={yearMin}
              max={yearMax}
              className="w-24 rounded border border-stone-300 px-2 py-2 bg-white text-stone-700"
            />
            <span className="text-stone-400">to</span>
            <input
              type="number"
              value={yearTo}
              onChange={(e) =>
                setYearTo(e.target.value ? Number(e.target.value) : "")
              }
              placeholder={String(yearMax)}
              min={yearMin}
              max={yearMax}
              className="w-24 rounded border border-stone-300 px-2 py-2 bg-white text-stone-700"
            />
            {(selectedPlace || yearFrom !== "" || yearTo !== "") && (
              <button
                type="button"
                onClick={() => {
                  setSelectedPlace("");
                  setYearFrom("");
                  setYearTo("");
                }}
                className="text-stone-400 hover:text-stone-700 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </form>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        {results.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {results.map((card, i) => (
                <div
                  key={card.ppn}
                  className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden hover:shadow-md transition"
                >
                  <div className="relative aspect-[3/4] bg-stone-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${API}${card.local_image_url}`}
                      alt={card.subtitle || "Menu card"}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          card.iiif_image_url;
                      }}
                    />
                    <span className="absolute top-2 left-2 bg-stone-900/70 text-white text-xs px-2 py-0.5 rounded-full">
                      [{i + 1}]
                    </span>
                  </div>
                  <div className="p-3 space-y-1">
                    {card.subtitle && (
                      <p className="font-semibold text-sm leading-tight">
                        {card.subtitle}
                      </p>
                    )}
                    <div className="flex gap-2 text-xs text-stone-500 flex-wrap">
                      {card.date && <span>{card.date}</span>}
                      {card.place && <span>{card.place}</span>}
                    </div>
                    {card.description && (
                      <p className="text-xs text-stone-600 line-clamp-3">
                        {card.description}
                      </p>
                    )}
                    <p className="text-xs text-stone-400">
                      Score: {(card.score * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 items-center">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="bg-amber-700 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 transition"
              >
                {generating ? "Asking archivist..." : "Ask the archivist"}
              </button>
              <span className="text-stone-400 text-sm">
                Summarise these {results.length} results with AI
              </span>
            </div>

            {answer && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                <h2 className="font-semibold text-amber-900 mb-2">
                  Archivist response
                </h2>
                <p className="text-stone-800 text-sm leading-relaxed whitespace-pre-wrap">
                  {answer}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
