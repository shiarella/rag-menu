"use client";

export default function IIIFViewer({ manifestUrl }: { manifestUrl: string }) {
  // UV is self-hosted in /public/uv — no external dependency
  const src = `/uv/uv.html#?manifest=${encodeURIComponent(manifestUrl)}&cv=0`;

  return (
    <iframe
      src={src}
      className="w-full aspect-square"
      allowFullScreen
      title="IIIF Viewer"
    />
  );
}
