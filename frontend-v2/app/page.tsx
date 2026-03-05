"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  ChevronDown,
  ChevronUp,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

const API = "http://localhost:8000";
const PAGE_SIZE = 12;

interface CardResult {
  ppn: string;
  subtitle: string;
  description: string;
  place: string;
  date: string;
  local_image_url: string;
  iiif_image_url: string;
  score: number;
}

interface SearchResponse {
  results: CardResult[];
  total_candidates: number;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [place, setPlace] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  // minScore is 0–100 (percentage), applied client-side after fetch
  const [minScore, setMinScore] = useState(0);

  const [allResults, setAllResults] = useState<CardResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  // true when filters changed after last search — prompts user to re-search
  const [filtersDirty, setFiltersDirty] = useState(false);

  // Archivist (AI interpretation)
  const [answer, setAnswer] = useState("");
  const [generating, setGenerating] = useState(false);

  const hasFilters = place || yearFrom || yearTo;
  const isFacetOnly = !query.trim();

  async function runSearch(overrides?: {
    place?: string;
    yearFrom?: string;
    yearTo?: string;
  }) {
    const p = overrides?.place ?? place;
    const yf = overrides?.yearFrom ?? yearFrom;
    const yt = overrides?.yearTo ?? yearTo;
    if (!query.trim() && !p && !yf && !yt) return;

    setLoading(true);
    setError("");
    setAllResults([]);
    setPage(1);
    setFiltersDirty(false);
    setAnswer("");

    try {
      const body: Record<string, unknown> = { query };
      if (p) body.place = p;
      if (yf) body.year_from = Number(yf);
      if (yt) body.year_to = Number(yt);

      const res = await fetch(`${API}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data: SearchResponse = await res.json();
      setAllResults(data.results);
    } catch {
      setError("Could not reach the API — is uvicorn running on port 8000?");
    } finally {
      setLoading(false);
    }
  }

  function clearFilters() {
    setPlace("");
    setYearFrom("");
    setYearTo("");
    // Re-run search without the filters so results update immediately
    runSearch({ place: "", yearFrom: "", yearTo: "" });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch();
  }

  async function handleGenerate(scope: "page") {
    const toSend = scope === "page" ? pageResults : filtered;
    if (!toSend.length) return;
    setGenerating(true);
    setAnswer("");
    // For facet-only browses there's no query; synthesise one from active filters
    const effectiveQuery =
      query.trim() ||
      [
        place && `place: ${place}`,
        yearFrom && `from ${yearFrom}`,
        yearTo && `to ${yearTo}`,
      ]
        .filter(Boolean)
        .join(", ");
    try {
      const res = await fetch(`${API}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: effectiveQuery,
          results: toSend,
          start_index: (page - 1) * PAGE_SIZE + 1,
          page,
          total_pages: totalPages,
          total_results: filtered.length,
        }),
      });
      const data = await res.json();
      setAnswer(data.answer);
    } catch {
      setAnswer("Generation failed — is Ollama running?");
    } finally {
      setGenerating(false);
    }
  }

  // Client-side relevance filter + pagination — no extra fetch needed
  const filtered = useMemo(
    () =>
      isFacetOnly
        ? allResults
        : allResults.filter((r) => r.score * 100 >= minScore),
    [allResults, minScore, isFacetOnly],
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageResults = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-start px-4 py-12">
      <div className="w-full max-w-2xl mx-auto space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Search the collection
          </h1>
          <p className="text-sm text-muted-foreground">
            AI-powered discovery across 2,403 historical menu cards ·
            Staatsbibliothek zu Berlin
          </p>
        </div>

        <form onSubmit={handleSearch} className="space-y-3">
          {/* Main search row */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. elegant dinner on an ocean liner"
                className="pl-9 h-12 text-base"
              />
            </div>
            <Button
              type="submit"
              disabled={loading || (!query.trim() && !hasFilters)}
              className={`h-12 w-28 transition-all ${filtersDirty ? "ring-2 ring-primary ring-offset-2" : ""}`}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </div>

          {/* Advanced filters toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showFilters ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              Narrow by place or date
              {hasFilters && (
                <span
                  className="ml-1 rounded-full bg-primary w-1.5 h-1.5 inline-block"
                  aria-label="filters active"
                />
              )}
            </button>

            {showFilters && (
              <div className="mt-3 rounded-lg border border-border bg-muted/40 p-4 space-y-4">
                <p className="text-xs text-muted-foreground">
                  These filters are sent with your search. Hit Search to apply,
                  or Clear to reset and re-run.
                </p>

                {/* Place */}
                <div className="space-y-1">
                  <label htmlFor="filter-place" className="text-xs font-medium">
                    Place of issue
                  </label>
                  <Input
                    id="filter-place"
                    value={place}
                    onChange={(e) => {
                      setPlace(e.target.value);
                      if (allResults.length) setFiltersDirty(true);
                    }}
                    placeholder="e.g. Berlin, Hamburg, Norddeutscher Lloyd"
                    className="h-9 text-sm bg-background"
                  />
                </div>

                {/* Year range */}
                <div className="space-y-1">
                  <label className="text-xs font-medium">Year range</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={yearFrom}
                      onChange={(e) => {
                        setYearFrom(e.target.value);
                        if (allResults.length) setFiltersDirty(true);
                      }}
                      placeholder="From"
                      min={1700}
                      max={1950}
                      className="h-9 text-sm w-28 bg-background"
                    />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input
                      type="number"
                      value={yearTo}
                      onChange={(e) => {
                        setYearTo(e.target.value);
                        if (allResults.length) setFiltersDirty(true);
                      }}
                      placeholder="To"
                      min={1700}
                      max={1950}
                      className="h-9 text-sm w-28 bg-background"
                    />
                  </div>
                </div>

                {hasFilters && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="text-muted-foreground h-7 px-2 text-xs"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            )}
          </div>
          {filtersDirty && (
            <p className="text-xs text-primary">
              Filters changed — click Search to update results.
            </p>
          )}
        </form>

        {/* Separator — always present so layout doesn't shift */}
        <hr className="border-border" />

        {/* Error */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Searching…</span>
          </div>
        )}

        {/* Empty state — shown before any search */}
        {!loading && allResults.length === 0 && !error && (
          <p className="text-sm text-muted-foreground py-4">
            Enter a query above to search the collection.
          </p>
        )}

        {/* Results */}
        {!loading && allResults.length > 0 && (
          <div className="space-y-4">
            {/* Relevance slider — client-side, instant, only for semantic searches */}
            {!isFacetOnly && (
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground shrink-0">
                  Min relevance
                </span>
                <Slider
                  min={0}
                  max={80}
                  step={5}
                  value={[minScore]}
                  onValueChange={([v]) => {
                    setMinScore(v);
                    setPage(1);
                    setAnswer("");
                  }}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                  {minScore}%
                </span>
              </div>
            )}

            {/* Summary row */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {filtered.length === allResults.length
                  ? `${allResults.length} results`
                  : `${filtered.length} of ${allResults.length} results (relevance filtered)`}
                {totalPages > 1 && ` — page ${page} of ${totalPages}`}
              </p>
            </div>

            {/* Archivist — interpret this page */}
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Ask the Archivist</p>
                  <p className="text-xs text-muted-foreground">
                    AI summary of the {pageResults.length} cards on this page
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGenerate("page")}
                  disabled={generating}
                  className="shrink-0"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Thinking…
                    </>
                  ) : (
                    "Interpret this page"
                  )}
                </Button>
              </div>
              {answer && (
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap border-t border-border pt-3">
                  {answer}
                </p>
              )}
            </div>

            {/* Card grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {pageResults.map((card, i) => (
                <Link
                  key={card.ppn}
                  href={`/card/${card.ppn}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow flex flex-col group"
                >
                  <div className="relative aspect-3/4 bg-muted">
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
                    {/* Position number — top-left */}
                    <span className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full tabular-nums font-medium">
                      {(page - 1) * PAGE_SIZE + i + 1}
                    </span>
                  </div>
                  <div className="p-3 flex flex-col flex-1 space-y-1.5">
                    <div className="flex-1 space-y-1.5">
                      {card.subtitle && (
                        <p className="font-medium text-sm leading-tight line-clamp-2">
                          {card.subtitle}
                        </p>
                      )}
                      <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
                        {card.date && <span>{card.date}</span>}
                        {card.place && <span>{card.place}</span>}
                      </div>
                      {card.description && (
                        <p className="text-xs text-muted-foreground line-clamp-3">
                          {card.description}
                        </p>
                      )}
                    </div>
                    {/* Relevance bar — always at card bottom, only for semantic searches */}
                    {card.score > 0 && (
                      <div className="pt-1.5 space-y-0.5">
                        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/60"
                            style={{
                              width: `${(card.score * 100).toFixed(0)}%`,
                            }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground/60 tabular-nums">
                          {(card.score * 100).toFixed(0)}% match
                        </p>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPage((p) => Math.max(1, p - 1));
                    setAnswer("");
                  }}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPage((p) => Math.min(totalPages, p + 1));
                    setAnswer("");
                  }}
                  disabled={page === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
