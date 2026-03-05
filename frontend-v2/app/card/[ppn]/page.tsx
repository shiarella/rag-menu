import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileJson } from "lucide-react";
import IIIFViewer from "@/components/iiif-viewer";

const API = "http://localhost:8000";

interface CardRecord {
  ppn: string;
  title: string;
  subtitle: string;
  description: string;
  place: string;
  date: string;
  iiif_manifest_url: string;
  iiif_image_url: string;
  local_image_url: string;
}

async function fetchCard(ppn: string): Promise<CardRecord | null> {
  try {
    const res = await fetch(`${API}/card/${ppn}`, { cache: "force-cache" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function CardPage({
  params,
}: {
  params: Promise<{ ppn: string }>;
}) {
  const { ppn } = await params;
  const card = await fetchCard(ppn);
  if (!card) notFound();

  const fields = [
    { label: "Title", value: card.title || card.subtitle },
    { label: "Date", value: card.date },
    { label: "Place", value: card.place },
    { label: "Description", value: card.description },
    { label: "PPN", value: card.ppn },
  ].filter((f) => f.value);

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to search
        </Link>

        {/* Title */}
        <div>
          <h1 className="text-xl font-semibold leading-tight">
            {card.subtitle || card.title || card.ppn}
          </h1>
          {card.date && (
            <p className="text-sm text-muted-foreground mt-0.5">{card.date}</p>
          )}
        </div>

        {/* Main content: viewer + metadata side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* IIIF viewer */}
          <div className="rounded-lg border border-border overflow-hidden bg-muted/20">
            <IIIFViewer manifestUrl={card.iiif_manifest_url} />
          </div>

          {/* Metadata panel */}
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-5 space-y-3">
              <h2 className="text-sm font-medium">Catalogue record</h2>
              <dl className="space-y-2">
                {fields.map(({ label, value }) => (
                  <div
                    key={label}
                    className="grid grid-cols-[7rem_1fr] gap-x-3 text-sm"
                  >
                    <dt className="text-muted-foreground font-medium shrink-0">
                      {label}
                    </dt>
                    <dd className="text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* External links */}
            <div className="flex gap-3 text-xs">
              <a
                href={`https://stabikat.de/DB=1/XMLPRS=N/PPN?PPN=${card.ppn}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                View in StabiKat catalogue ↗
              </a>
              <a
                href={card.iiif_manifest_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                <FileJson className="h-3 w-3" />
                IIIF manifest
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
