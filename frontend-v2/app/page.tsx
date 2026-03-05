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
  Settings2,
  Info,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

const API = process.env.NEXT_PUBLIC_API ?? "http://localhost:8000";
const PAGE_SIZE = 12;

/** Hover tooltip — works reliably where SVG `title` attributes don't. */
function Tip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center shrink-0">
      <Info className="h-3 w-3 text-muted-foreground group-hover:text-foreground cursor-help transition-colors" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md
                   opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 leading-relaxed"
      >
        {text}
      </span>
    </span>
  );
}

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
  search_mode: string;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
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
  const [answerOpen, setAnswerOpen] = useState(true);

  // Smart Parse mode — LLM decomposes the query before searching
  const [smartParse, setSmartParse] = useState(false);
  const [caveat, setCaveat] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsedQuery, setParsedQuery] = useState(""); // what LLM rewrote the query to

  // Search mode: "meta" | "ocr" | "both"
  const [searchMode, setSearchMode] = useState<"meta" | "ocr" | "both">("meta");
  // Blend weight for "both" mode: 0 = all OCR, 100 = all metadata (maps to meta_weight 0–1)
  const [metaWeight, setMetaWeight] = useState(50);
  // Reflects what mode the API actually used (may fall back to "meta" if OCR index isn't built)
  const [activeMode, setActiveMode] = useState("meta");
  // True once at least one search has completed (distinguishes pre-search from zero-results)
  const [hasSearched, setHasSearched] = useState(false);

  // Derived: which search_mode to send based on selected sources
  const derivedMode: "meta" | "ocr" | "both" =
    searchMode === "both" ? "both" : searchMode === "ocr" ? "ocr" : "meta";

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
    setCaveat("");
    setParsedQuery("");

    // Smart Parse: ask the LLM to decompose the query before searching
    let searchQuery = query;
    let parsedPlace = p;
    let parsedYearFrom = yf;
    let parsedYearTo = yt;

    if (smartParse && query.trim()) {
      setParsing(true);
      try {
        const pr = await fetch(`${API}/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const pd = await pr.json();
        searchQuery = pd.semantic_query || query;
        if (pd.semantic_query) setParsedQuery(pd.semantic_query);
        if (pd.place) {
          parsedPlace = pd.place;
          setPlace(pd.place);
        }
        if (pd.year_from) {
          parsedYearFrom = String(pd.year_from);
          setYearFrom(String(pd.year_from));
        }
        if (pd.year_to) {
          parsedYearTo = String(pd.year_to);
          setYearTo(String(pd.year_to));
        }
        if (pd.caveat) setCaveat(pd.caveat);
      } catch {
        // parse failed — fall through with original query
      } finally {
        setParsing(false);
      }
    }

    try {
      const body: Record<string, unknown> = {
        query: searchQuery,
        search_mode: derivedMode,
      };
      if (derivedMode === "both") body.meta_weight = metaWeight / 100;
      if (parsedPlace) body.place = parsedPlace;
      if (parsedYearFrom) body.year_from = Number(parsedYearFrom);
      if (parsedYearTo) body.year_to = Number(parsedYearTo);

      const res = await fetch(`${API}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data: SearchResponse = await res.json();
      setAllResults(data.results);
      setActiveMode(data.search_mode ?? "meta");
      setHasSearched(true);
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
      setAnswerOpen(true);
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
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Search the collection
          </h1>
          <p className="text-sm text-muted-foreground">
            AI-powered discovery across 2,403 historical menus ·
            Staatsbibliothek zu Berlin
          </p>
        </div>

        <form onSubmit={handleSearch} className="space-y-4">
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
              disabled={loading || parsing || (!query.trim() && !hasFilters)}
              className={`h-12 w-28 transition-all ${filtersDirty ? "ring-2 ring-primary ring-offset-2" : ""}`}
            >
              {loading || parsing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {parsing && <span className="ml-1.5 text-xs">Parsing…</span>}
                </>
              ) : (
                "Search"
              )}
            </Button>
          </div>

          {/* ── Advanced settings ─────────────────────────────── */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings2 className="h-3 w-3" />
              <span>Advanced settings</span>
              {(searchMode !== "meta" ||
                smartParse ||
                hasFilters ||
                minScore > 0 ||
                metaWeight !== 50) && (
                <span
                  className="rounded-full bg-primary w-1.5 h-1.5 inline-block"
                  aria-label="non-default settings active"
                />
              )}
              {showAdvanced ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-2 rounded-lg border border-border bg-muted/40 p-4 space-y-5">
                {/* 1 — Search index */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">Search index</span>
                    <Tip text="Select one or more sources to search. Metadata uses the catalogue record. OCR uses text extracted from the card images. When both are selected, each is queried independently and results are merged by best score (late fusion)." />
                  </div>

                  {/* Live sources */}
                  {[
                    {
                      id: "meta" as const,
                      label: "Metadata",
                      sub: "Catalogue record — title, place, date, description",
                    },
                    {
                      id: "ocr" as const,
                      label: "OCR",
                      sub: "Text extracted from card images via Tesseract",
                    },
                  ].map(({ id, label, sub }) => {
                    const checked = searchMode === id || searchMode === "both";
                    return (
                      <label
                        key={id}
                        className="flex items-start gap-2.5 cursor-pointer group"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const otherChecked =
                              id === "meta"
                                ? searchMode === "ocr" || searchMode === "both"
                                : searchMode === "meta" ||
                                  searchMode === "both";
                            const nextMode = !checked
                              ? otherChecked
                                ? "both"
                                : id
                              : otherChecked
                                ? id === "meta"
                                  ? "ocr"
                                  : "meta"
                                : "meta";
                            setSearchMode(nextMode);
                            if (allResults.length) setFiltersDirty(true);
                          }}
                          className="mt-0.5 h-3.5 w-3.5 accent-primary cursor-pointer"
                        />
                        <span className="space-y-0.5">
                          <span className="text-xs font-medium group-hover:text-foreground transition-colors block">
                            {label}
                          </span>
                          <span className="text-xs text-muted-foreground block">
                            {sub}
                          </span>
                        </span>
                      </label>
                    );
                  })}

                  {/* Coming-soon sources */}
                  {[
                    {
                      label: "CLIP",
                      sub: "Visual similarity — matches card layout, era, and style from images",
                    },
                    {
                      label: "Vision LLM",
                      sub: "llama3.2-vision describes each card in prose; highest quality but slow to precompute",
                    },
                  ].map(({ label, sub }) => (
                    <label
                      key={label}
                      className="flex items-start gap-2.5 opacity-50 cursor-not-allowed"
                    >
                      <input
                        type="checkbox"
                        disabled
                        checked={false}
                        readOnly
                        className="mt-0.5 h-3.5 w-3.5 cursor-not-allowed"
                      />
                      <span className="space-y-0.5">
                        <span className="text-xs font-medium flex items-center gap-1.5">
                          {label}
                          <span className="text-[10px] border border-border rounded px-1 py-px text-muted-foreground font-normal">
                            coming soon
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground block">
                          {sub}
                        </span>
                      </span>
                    </label>
                  ))}

                  {!filtersDirty &&
                    searchMode !== "meta" &&
                    activeMode === "meta" &&
                    allResults.length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        OCR index not built yet — fell back to metadata only.
                      </p>
                    )}

                  {/* Blend slider — only when both sources are active */}
                  {searchMode === "both" && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">Index blend</span>
                        <Tip text="Controls how much each index contributes to the final score. At 50% both contribute equally. Slide left to weight OCR higher (good for food/dish queries); slide right to weight catalogue metadata higher (good for place/date queries). A card that scores well in both will naturally rank above one that only scores well in one." />
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                          {metaWeight === 50
                            ? "50 / 50"
                            : metaWeight < 50
                              ? `OCR  +${50 - metaWeight}%`
                              : `Meta +${metaWeight - 50}%`}
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={100}
                        step={10}
                        value={[metaWeight]}
                        onValueChange={([v]) => {
                          setMetaWeight(v);
                          if (allResults.length) setFiltersDirty(true);
                        }}
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>← OCR</span>
                        <span>Metadata →</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2 — Smart Parse */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">Smart Parse</span>
                    <Tip text="Before searching, sends your query to a local LLM which extracts place and year, then rephrases the remaining semantic part for better recall. Adds ~1–2 s per search. Leave off for direct keyword or phrase searches." />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSmartParse((v) => !v);
                      if (allResults.length) setFiltersDirty(true);
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      smartParse ? "bg-primary" : "bg-input"
                    }`}
                    role="switch"
                    aria-checked={smartParse}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                        smartParse ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* 3 — Narrow by place or date */}
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">
                      Narrow by place or date
                    </span>
                    <Tip text="Hard filters applied server-side before ranking. Place is a case-insensitive substring match — e.g. 'Hamburg' matches 'Hamburg-Amerika Linie'. Year filters by the printed date on the menu card and are both inclusive." />
                  </div>
                  <Input
                    id="filter-place"
                    value={place}
                    onChange={(e) => {
                      setPlace(e.target.value);
                      if (allResults.length) setFiltersDirty(true);
                    }}
                    placeholder="Place — e.g. Berlin, Hamburg, Norddeutscher Lloyd"
                    className="h-9 text-sm bg-background"
                  />
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">
                        &ge;
                      </span>
                      <Input
                        type="number"
                        value={yearFrom}
                        onChange={(e) => {
                          setYearFrom(e.target.value);
                          if (allResults.length) setFiltersDirty(true);
                        }}
                        placeholder="1880"
                        min={1700}
                        max={1950}
                        className="h-9 text-sm pl-6 bg-background"
                      />
                    </div>
                    <span className="text-muted-foreground text-xs shrink-0">
                      –
                    </span>
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">
                        &le;
                      </span>
                      <Input
                        type="number"
                        value={yearTo}
                        onChange={(e) => {
                          setYearTo(e.target.value);
                          if (allResults.length) setFiltersDirty(true);
                        }}
                        placeholder="1920"
                        min={1700}
                        max={1950}
                        className="h-9 text-sm pl-6 bg-background"
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
                      Clear place &amp; date
                    </Button>
                  )}
                </div>

                {/* 4 — Min relevance */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">Min relevance</span>
                    <Tip text="Hides results whose similarity score falls below this threshold. Applied instantly in the browser — no re-search needed. 0% shows everything returned; raise it to surface only close matches." />
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {minScore}%
                    </span>
                  </div>
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
                    disabled={isFacetOnly}
                  />
                  {isFacetOnly && (
                    <p className="text-xs text-muted-foreground">
                      Not applicable for place/date-only searches.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Status row — parsed-query chip + dirty notice */}
          {(parsedQuery || filtersDirty) && (
            <div className="flex items-center gap-3 flex-wrap">
              {parsedQuery && (
                <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/15 px-2 py-0.5 text-xs text-primary font-medium">
                  searched as:{" "}
                  <span className="italic font-normal">{parsedQuery}</span>
                </span>
              )}
              {filtersDirty && (
                <p className="text-xs text-primary">
                  Settings changed — click Search to update.
                </p>
              )}
            </div>
          )}
        </form>

        {/* Smart Parse caveat */}
        {caveat && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-4 py-3">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <span className="font-medium">Note: </span>
              {caveat}
            </p>
          </div>
        )}

        {/* Separator — always present so layout doesn't shift */}
        <hr className="border-border mt-2" />

        {/* Error */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Searching…</span>
          </div>
        )}

        {/* Empty state — before any search */}
        {!loading && !hasSearched && allResults.length === 0 && !error && (
          <p className="text-sm text-muted-foreground py-4">
            Enter a query above to search the collection.
          </p>
        )}

        {/* Empty state — search ran but nothing matched */}
        {!loading && hasSearched && allResults.length === 0 && !error && (
          <div className="py-6 space-y-1">
            <p className="text-sm font-medium">No results found.</p>
            <p className="text-xs text-muted-foreground">
              Try a broader query
              {hasFilters ? ", or remove the place / date filters" : ""}.
              {minScore > 0 &&
                " Lowering Min relevance in Advanced settings may also reveal more matches."}
            </p>
          </div>
        )}

        {/* Empty state — results exist but all filtered out client-side */}
        {!loading &&
          hasSearched &&
          allResults.length > 0 &&
          filtered.length === 0 &&
          !error && (
            <div className="py-6 space-y-1">
              <p className="text-sm font-medium">
                All results hidden by Min relevance filter.
              </p>
              <p className="text-xs text-muted-foreground">
                Lower the threshold in Advanced settings to see more.
              </p>
            </div>
          )}

        {/* Results */}
        {!loading && allResults.length > 0 && (
          <div className="space-y-4">
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
                  <p className="text-sm font-medium">Ask the A(I)rchivist</p>
                  <p className="text-xs text-muted-foreground">
                    AI summary of the {pageResults.length} menus on this page
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
                <div className="border-t border-border pt-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => setAnswerOpen((v) => !v)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {answerOpen ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    {answerOpen ? "Hide" : "Show"}
                  </button>
                  {answerOpen && (
                    <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                      {answer}
                    </p>
                  )}
                </div>
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
