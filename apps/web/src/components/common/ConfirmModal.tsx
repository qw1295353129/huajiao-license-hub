import { useState, type ReactNode } from 'react';
import { Button, Modal, TextArea, TextField, Label } from '@heroui/react';

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
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Modal.Trigger>{trigger}</Modal.Trigger>
      <Modal.Backdrop isDismissable variant="blur">
        <Modal.Container size="sm" placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              {description ? <p className="text-sm opacity-70">{description}</p> : null}
              {withReason ? (
                <TextField name="reason" value={reason} onChange={setReason} fullWidth>
                  <Label>{reasonLabel}</Label>
                  <TextArea rows={2} placeholder="例如：买家退款 / 账号共享" />
                </TextField>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setOpen(false)} isDisabled={busy}>
                取消
              </Button>
              <Button variant={danger ? 'danger' : 'primary'} onPress={() => void submit()} isDisabled={busy}>
                {busy ? '处理中…' : confirmLabel}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
