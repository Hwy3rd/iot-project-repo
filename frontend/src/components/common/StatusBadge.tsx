import type { AlertStatus, DeviceStatus } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { ALERT_STATUS_LABEL, DEVICE_STATUS_LABEL } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const TONE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
}

export function ToneBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn('border-transparent', TONE[tone])}>
      {children}
    </Badge>
  )
}

const DEVICE_TONE: Record<DeviceStatus, Tone> = {
  registered: 'neutral',
  provisioned: 'info',
  active: 'success',
  offline: 'warning',
  fault: 'danger',
  maintenance: 'warning',
  decommissioned: 'neutral',
}

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  return <ToneBadge tone={DEVICE_TONE[status]}>{DEVICE_STATUS_LABEL[status]}</ToneBadge>
}

const ALERT_STATUS_TONE: Record<AlertStatus, Tone> = {
  open: 'danger',
  acknowledged: 'warning',
  resolved: 'success',
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  return <ToneBadge tone={ALERT_STATUS_TONE[status]}>{ALERT_STATUS_LABEL[status]}</ToneBadge>
}
