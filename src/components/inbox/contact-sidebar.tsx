"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [sourceLinkName, setSourceLinkName] = useState<string | null>(null);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }

    // Origem do lead (Links Rastreáveis), quando atribuída.
    if (contact.source_link_id) {
      const { data: sourceLink } = await supabase
        .from('tracking_links')
        .select('name')
        .eq('id', contact.source_link_id)
        .maybeSingle();
      setSourceLinkName(sourceLink?.name ?? null);
    } else {
      setSourceLinkName(null);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    } else {
      // Antes falhava em silêncio: o agente achava que salvou. Agora avisa
      // e mantém o rascunho no campo pra ele tentar de novo.
      console.error("Failed to add note:", error);
      toast.error("Não foi possível salvar a nota");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#080711]">
        <p className="text-sm text-[#8f86a8]">Selecione uma conversa</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-full flex-col bg-[#080711]">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-4">
          {/* Contact Info */}
          <div className="rounded-xl border border-[#191528] bg-[#0d0b16] p-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-lg font-bold text-emerald-300 ring-1 ring-emerald-400/30">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-[#f1edff]">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-[#8f86a8]">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg border border-[#191528] bg-[#0d0b16] px-3 py-2 text-sm text-[#8f86a8] transition-colors hover:bg-[#151324] hover:text-white"
            >
              <Phone className="h-4 w-4 text-[#756c8f]" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-[#9900ff]" />
              ) : (
                <Copy className="h-3 w-3 text-[#756c8f]" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-[#191528]" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[#756c8f]">
              <TagIcon className="h-3 w-3" />
              Tags
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Sem tags</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {(contact.source_link_id || contact.source_utm) && (
            <>
              {/* Divider */}
              <div className="border-t border-[#191528]" />

              {/* Origem (Links Rastreáveis) */}
              <div>
                <div className="flex items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[#756c8f]">
                  <Link2 className="h-3 w-3" />
                  Origem
                </div>
                <div className="mt-2 space-y-1 px-1">
                  {sourceLinkName && (
                    <p className="text-sm font-medium text-foreground">
                      {sourceLinkName}
                    </p>
                  )}
                  {contact.source_utm && (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(contact.source_utm).map(
                        ([key, value]) => (
                          <span
                            key={key}
                            className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            title={key}
                          >
                            {key.replace('utm_', '')}: {value}
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="border-t border-[#191528]" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[#756c8f]">
              <DollarSign className="h-3 w-3" />
              Negócios Ativos
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Sem negócios</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg border border-[#191528] bg-[#0d0b16] px-3 py-2"
                  >
                    <p className="text-sm font-medium text-[#f1edff]">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-[#8f86a8]">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#191528]" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[#756c8f]">
              <StickyNote className="h-3 w-3" />
              Notas
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Adicionar uma nota..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-[#191528] bg-[#0d0b16] px-3 py-2 text-xs text-[#f1edff] placeholder:text-[#756c8f] outline-none focus:border-[#9900ff]"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg border border-[#191528] bg-[#0d0b16] px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "d MMM yyyy HH:mm", {
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
