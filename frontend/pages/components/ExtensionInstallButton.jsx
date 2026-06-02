import { useState } from 'react';
import { useExtensionPresent } from '../../extensionBridge.js';
import ExtensionInstallModal from './ExtensionInstallModal.jsx';

// Tasteful right-sidebar entry point to the extension install modal. Hidden once
// the extension is detected on the page (nothing left to install).
export default function ExtensionInstallButton() {
  const present = useExtensionPresent();
  const [open, setOpen] = useState(false);
  if (present) return null;

  return (
    <>
      <button type="button" className="ext-install-btn" onClick={() => setOpen(true)}>
        Install Extension
      </button>
      {open && <ExtensionInstallModal onClose={() => setOpen(false)} />}
    </>
  );
}
