"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const API = "http://localhost:8000";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const GREETING =
  "I'm ready to answer questions about this menu card. What would you like to know?";

export default function CardChat({ ppn }: { ppn: string }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Don't send the greeting — it's synthetic, not from the model
        body: JSON.stringify({
          ppn,
          messages: next.filter(
            (m) => !(m.role === "assistant" && m.content === GREETING),
          ),
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong — is Ollama running?",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 flex flex-col">
      <div className="px-5 pt-4 pb-2 border-b border-border">
        <p className="text-sm font-medium">Ask the Archivist</p>
        <p className="text-xs text-muted-foreground">Chat about this card</p>
      </div>

      {/* Message list */}
      <div className="flex flex-col gap-3 px-5 py-4 max-h-80 overflow-y-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`rounded-2xl px-3 py-2 text-sm max-w-[85%] leading-relaxed ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-background border border-border rounded-bl-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-background border border-border rounded-2xl rounded-bl-sm px-3 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="flex gap-2 px-5 pb-4 pt-2 border-t border-border">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask a question…"
          className="flex-1 h-9 text-sm bg-background"
          disabled={loading}
        />
        <Button
          size="sm"
          className="h-9 w-9 p-0"
          onClick={send}
          disabled={loading || !input.trim()}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
