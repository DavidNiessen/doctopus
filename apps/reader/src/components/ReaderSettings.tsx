import { useEffect, useRef } from 'react';
import type { ReaderPreferences } from '../reader-preferences.js';
import { useUi } from '../ui-translation.js';
import { ReaderSettingsControls } from './ReaderSettingsControls.js';
import { Icon } from './Icon.js';
export default function ReaderSettings({
  value,
  onChange,
  onClose,
  stored,
}: {
  value: ReaderPreferences;
  onChange: (value: ReaderPreferences) => void;
  onClose: () => void;
  stored: boolean;
}) {
  const t = useUi();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="reader-settings"
      aria-labelledby="reader-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="reader-settings-heading">
        <div>
          <h2 id="reader-settings-title">{t('appearance.title')}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('appearance.close')}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      <ReaderSettingsControls
        value={value}
        onChange={onChange}
        stored={stored}
      />
    </dialog>
  );
}
