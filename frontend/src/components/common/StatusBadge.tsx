import type {
  AlertStatus,
  BatchStatus,
  CommandStatus,
  DeviceStatus,
  UserStatus,
  WorkShiftStatus,
} from '@/api/types'
import { Badge } from '@/components/ui/badge'
import {
  ALERT_STATUS_LABEL,
  BATCH_STATUS_LABEL,
  COMMAND_STATUS_LABEL,
  DEVICE_STATUS_LABEL,
  USER_STATUS_LABEL,
  WORK_SHIFT_STATUS_LABEL,
} from '@/lib/labels'
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
    <Badge variant="outline" className={cn('h-6 border-transparent px-2.5 text-sm', TONE[tone])}>
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

const BATCH_TONE: Record<BatchStatus, Tone> = {
  in_stock: 'success',
  expired: 'danger',
  removed: 'neutral',
}

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return <ToneBadge tone={BATCH_TONE[status]}>{BATCH_STATUS_LABEL[status]}</ToneBadge>
}

const COMMAND_TONE: Record<CommandStatus, Tone> = {
  pending: 'neutral',
  sent: 'info',
  done: 'success',
  failed: 'danger',
}

export function CommandStatusBadge({ status }: { status: CommandStatus }) {
  return <ToneBadge tone={COMMAND_TONE[status]}>{COMMAND_STATUS_LABEL[status]}</ToneBadge>
}

const WORK_SHIFT_TONE: Record<WorkShiftStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  expired: 'neutral',
}

export function WorkShiftStatusBadge({ status }: { status: WorkShiftStatus }) {
  return <ToneBadge tone={WORK_SHIFT_TONE[status]}>{WORK_SHIFT_STATUS_LABEL[status]}</ToneBadge>
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return (
    <ToneBadge tone={status === 'active' ? 'success' : 'danger'}>
      {USER_STATUS_LABEL[status]}
    </ToneBadge>
  )
}
