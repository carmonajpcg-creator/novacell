import { useState } from 'react'
import { Copy, MessageCircle } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/shared/states'
import { Field, FormError } from '@/components/shared/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { client, useInvalidatingMutation } from '@/hooks/data'
import { describeDbError } from '@/lib/dbErrors'
import { formatDate, formatMXN, todayIso } from '@/lib/format'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import * as api from './api'
import { collectionKeys, useItemReminders } from './hooks'
import { buildReminderMessage, dueLabel } from './messages'
import { OUTCOME_LABEL, REMINDER_STATUS_LABEL, type QueueItem, type ReminderOutcome, type Reminder } from './types'

export function ReminderDialog({ item, onOpenChange }: { item: QueueItem | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      {item && (
        <DialogContent
          title="Recordatorio de cobranza"
          description="El envío es manual: el sistema prepara el mensaje y abre WhatsApp. Abrir WhatsApp no confirma que el mensaje se haya enviado."
        >
          <ReminderFlow item={item} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function ReminderFlow({ item }: { item: QueueItem }) {
  const history = useItemReminders(item)
  const [message, setMessage] = useState(() => buildReminderMessage(item))
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const invalidate = [collectionKeys.queue, collectionKeys.reminders(item.kind, item.ref_id)]
  const prepare = useInvalidatingMutation((text: string) => api.prepareReminder(client(), item, text), invalidate)
  const opened = useInvalidatingMutation((id: string) => api.markWhatsAppOpened(client(), id), invalidate)

  const current: Reminder | undefined = (history.data ?? []).find((r) => r.id === currentId)
  const url = buildWhatsAppUrl(item.customer_phone, current?.message ?? message)

  async function onPrepare() {
    setError(null)
    try {
      const r = await prepare.mutateAsync(message.trim())
      setCurrentId(r.id)
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  async function onOpenWhatsApp() {
    if (!current || !url) return
    window.open(url, '_blank', 'noopener,noreferrer')
    setError(null)
    if (current.status === 'prepared') {
      try {
        await opened.mutateAsync(current.id)
      } catch (e) {
        setError(describeDbError(e))
      }
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(current?.message ?? message)
      setCopied(true)
    } catch {
      setError('No se pudo copiar. Selecciona el texto y cópialo manualmente.')
    }
  }

  if (history.isPending) return <LoadingState label="Cargando seguimiento…" />
  if (history.isError) return <ErrorState message="No se pudo cargar el seguimiento." onRetry={() => void history.refetch()} />

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-muted p-3 text-sm">
        <p className="font-medium">{item.customer_name}</p>
        <p className="text-subtle">
          {item.folio}
          {item.installment_number ? ` · cuota ${item.installment_number}` : ''} · {formatMXN(item.amount_due)} ·{' '}
          {formatDate(item.due_date)} ({dueLabel(item.days_overdue)})
        </p>
        <p className="text-subtle">Teléfono: {item.customer_phone ?? 'sin teléfono registrado'}</p>
      </div>

      <Field id="rm-message" label="Mensaje" hint="Plantilla provisional. Edítalo antes de preparar el recordatorio.">
        <Textarea
          id="rm-message"
          value={current?.message ?? message}
          readOnly={current !== undefined}
          onChange={(e) => setMessage(e.target.value)}
        />
      </Field>

      {!current ? (
        <Button onClick={() => void onPrepare()} disabled={prepare.isPending || message.trim() === ''}>
          {prepare.isPending ? 'Preparando…' : 'Preparar recordatorio'}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={current.status === 'contacted' ? 'success' : 'brand'}>{REMINDER_STATUS_LABEL[current.status]}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onOpenWhatsApp()} disabled={!url || opened.isPending}>
              <MessageCircle className="size-4" aria-hidden /> Abrir WhatsApp
            </Button>
            <Button variant="secondary" onClick={() => void onCopy()}>
              <Copy className="size-4" aria-hidden /> {copied ? 'Copiado' : 'Copiar mensaje'}
            </Button>
          </div>
          {!url && (
            <p className="text-sm text-subtle">
              Este cliente no tiene un teléfono válido de 10 dígitos: copia el mensaje y envíalo por otro medio.
            </p>
          )}
          {current.status !== 'prepared' && (
            <p role="status" className="text-xs text-subtle">
              Se abrió WhatsApp con el mensaje. Eso no confirma que lo hayas enviado: registra abajo el resultado real del contacto.
            </p>
          )}
          {current.status !== 'contacted' ? (
            <FollowUpForm reminder={current} invalidate={invalidate} />
          ) : (
            <p className="text-sm">
              Resultado: <strong>{current.outcome ? OUTCOME_LABEL[current.outcome] : '—'}</strong>
              {current.promised_date ? ` · promete pagar el ${formatDate(current.promised_date)}` : ''}
              {current.note ? ` · ${current.note}` : ''}
            </p>
          )}
        </div>
      )}

      <FormError message={error} />

      {(history.data ?? []).length > 0 && (
        <section aria-label="Historial de seguimiento" className="space-y-2 border-t border-gray-100 pt-3">
          <h3 className="text-sm font-semibold">Historial</h3>
          <ul className="space-y-1 text-sm">
            {(history.data ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {formatDate(r.created_at)} · {REMINDER_STATUS_LABEL[r.status]}
                  {r.outcome ? ` · ${OUTCOME_LABEL[r.outcome]}` : ''}
                </span>
                {r.promised_date && <span className="text-subtle">promesa: {formatDate(r.promised_date)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function FollowUpForm({ reminder, invalidate }: { reminder: Reminder; invalidate: readonly (readonly unknown[])[] }) {
  const [outcome, setOutcome] = useState<ReminderOutcome>('no_answer')
  const [promised, setPromised] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const contacted = useInvalidatingMutation(
    (v: { outcome: ReminderOutcome; promisedDate: string | null; note: string | null }) =>
      api.markContacted(client(), reminder.id, v),
    invalidate,
  )

  async function onSave() {
    setError(null)
    if (outcome === 'promise_to_pay' && promised === '') {
      setError('Indica la fecha en que promete pagar')
      return
    }
    try {
      await contacted.mutateAsync({
        outcome,
        promisedDate: outcome === 'promise_to_pay' ? promised : null,
        note: note.trim() || null,
      })
    } catch (e) {
      setError(describeDbError(e))
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 p-3">
      <h3 className="text-sm font-semibold">Registrar seguimiento</h3>
      <Field id="fu-outcome" label="Resultado del contacto">
        <Select id="fu-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as ReminderOutcome)}>
          {Object.entries(OUTCOME_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      {outcome === 'promise_to_pay' && (
        <Field id="fu-date" label="Fecha prometida">
          <Input id="fu-date" type="date" min={todayIso()} value={promised} onChange={(e) => setPromised(e.target.value)} />
        </Field>
      )}
      <Field id="fu-note" label="Nota" hint="Opcional">
        <Input id="fu-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError message={error} />
      <Button variant="secondary" onClick={() => void onSave()} disabled={contacted.isPending}>
        {contacted.isPending ? 'Guardando…' : 'Guardar seguimiento'}
      </Button>
    </div>
  )
}
