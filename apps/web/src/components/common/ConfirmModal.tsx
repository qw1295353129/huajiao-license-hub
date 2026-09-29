import { useState, type ReactNode } from 'react';
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/animate-ui/components/radix/dialog';
import { Button } from '@/components/animate-ui/components/buttons/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

/** 危险操作二次确认：可选填写原因（会写入审计/事件）。 */
export function ConfirmModal({
  trigger,
  title,
  description,
  confirmLabel = '确认',
  danger = true,
  withReason = false,
  reasonLabel = '原因（可选）',
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  withReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason?: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(withReason ? reason : undefined);
      setOpen(false);
      setReason('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button">{trigger}</button>
      </DialogTrigger>
      {/* size="sm" → sm:max-w-md；DialogContent 自带右上角关闭按钮 */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          {description ? <p className="text-sm opacity-70">{description}</p> : null}
          {withReason ? (
            <div className="flex flex-col gap-1.5 w-full">
              <Label>{reasonLabel}</Label>
              <Textarea
                name="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="例如：买家退款 / 账号共享"
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button
            variant={danger ? 'destructive' : 'default'}
            className={danger ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground'}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
